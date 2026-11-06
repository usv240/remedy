import { afterEach, describe, expect, it, vi } from "vitest";
import { agencyTier, NOT_CHECKED, toAgencyHit } from "@/lib/recall/agencies";
import { AGENCY_NOTE, fdaEventUrl, fmtFdaDate, fmtNhtsaDate, goodCpscHit, nhtsaRecallUrl, parseVehicle, queryWords, searchAgencies } from "@/lib/recall/sources";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the second tier: FDA and NHTSA", () => {
  it("parses the agencies' dates and builds their links", () => {
    expect(fmtFdaDate("20250307")).toBe("2025-03-07");
    expect(fmtFdaDate("bad")).toBe("");
    expect(fmtNhtsaDate("28/05/2020")).toBe("2020-05-28");
    expect(fmtNhtsaDate("2024-12-20T00:00:00.000")).toBe("2024-12-20");
    expect(fmtNhtsaDate(undefined)).toBe("");
    expect(fdaEventUrl("88432")).toBe("https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=88432");
    expect(fdaEventUrl(undefined)).toMatch(/fda\.gov\/safety/);
    expect(nhtsaRecallUrl("24V960000")).toBe("https://www.nhtsa.gov/recalls?nhtsaId=24V960000");
    expect(parseVehicle("Honda Civic 2018")).toEqual({ make: "Honda", model: "Civic", year: "2018" });
    expect(parseVehicle("airbag")).toBeNull();
  });

  it("decides whether the CPSC search found the product", () => {
    const hits = [{ title: "HAIARA Power Banks Recalled", productNames: ["HAIARA Power Banks"], score: 12 }];
    expect(goodCpscHit("power bank", hits, "local")).toBe(true);
    expect(goodCpscHit("infant formula", [{ title: "Infant Loungers Recalled", productNames: ["Baby loungers"], score: 3 }], "local")).toBe(false);
    expect(goodCpscHit("airbag", [], "local")).toBe(false);
    // Elastic's fused score ranks hits; it does not say whether the top one fits, so the word rule applies there too.
    expect(goodCpscHit("airbag", [{ title: "Joolz Recalls Aer2 Car Seat Adapters", productNames: ["Car seat adapters"], score: 1.02 }], "elastic")).toBe(false);
    expect(goodCpscHit("infant formula", [{ title: "Bayer Recalls Afrin Nasal Spray", productNames: ["Nasal spray"], score: 0.95 }], "elastic")).toBe(false);
    expect(goodCpscHit("power banks", [{ title: "HAIARA Power Banks Recalled", productNames: ["HAIARA power banks"], score: 1.06 }], "elastic")).toBe(true);
    expect(goodCpscHit("crib that tips over", [{ title: "Dressers Recalled Due to Tip-Over", productNames: ["Dressers"], score: 1 }, { title: "Acme Cribs Recalled", productNames: ["Cribs"], score: 0.9 }], "elastic")).toBe(true);
    expect(queryWords("crib that tips over")).toEqual(["crib"]);
  });

  it("returns labelled hits from each agency, and never throws when one is down", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.fda.gov/food")) return json({ results: [{ product_description: "Infant formula, 12.4 oz", reason_for_recall: "Possible Cronobacter", status: "Ongoing", classification: "Class I", recalling_firm: "Able Groupe", recall_initiation_date: "20250307", recall_number: "F-0921-2025", event_id: "88432" }] });
      if (url.includes("api.fda.gov/drug")) throw new Error("ECONNRESET");
      if (url.includes("data.transportation.gov")) return json([{ nhtsa_id: "24V960000", manufacturer: "Mercedes-Benz USA, LLC", subject: "Mounting Brackets May Damage Air Bag", consequence_summary: "An air bag that is damaged can increase the risk of injury.", corrective_action: "Dealers will inspect and replace.", report_received_date: "2024-12-20T00:00:00.000" }]);
      return json({}, 500);
    }) as typeof fetch;
    // The mocks answer whatever the words are; NHTSA's own hits must still name every word of the query.
    const r = await searchAgencies("airbag", { timeoutMs: 1000 });
    expect(r.agencies.sort()).toEqual(["FDA", "NHTSA"]);
    const fda = r.hits.find((h) => h.agency === "FDA")!;
    expect(fda.title).toBe("Infant formula, 12.4 oz");
    expect(fda.date).toBe("2025-03-07");
    expect(fda.url).toContain("Event=88432");
    expect(fda.remedy).toBe("Class I, recall ongoing, by Able Groupe");
    const nhtsa = r.hits.find((h) => h.agency === "NHTSA")!;
    expect(nhtsa.ref).toBe("NHTSA-24V960000");
    expect(nhtsa.url).toBe("https://www.nhtsa.gov/recalls?nhtsaId=24V960000");
    expect(nhtsa.date).toBe("2024-12-20");
    const out = toAgencyHit(fda);
    expect(out.note).toBe(AGENCY_NOTE);
    expect(out.agency_name).toMatch(/Food and Drug/);
  });

  it("an agency that hangs is cut off by its timeout and the others still answer", async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("data.transportation.gov")) return Promise.resolve(json([{ nhtsa_id: "24V173000", manufacturer: "Faraday", subject: "Air bag", report_received_date: "2024-03-01T00:00:00.000" }]));
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }) as typeof fetch;
    const t = Date.now();
    const r = await searchAgencies("airbag", { timeoutMs: 300 });
    expect(Date.now() - t).toBeLessThan(3000);
    expect(r.agencies).toEqual(["NHTSA"]);
  });

  it("the tier is skipped when the CPSC search found the product", async () => {
    globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
    const skipped = await agencyTier("power bank", { mode: "local", hits: [{ title: "HAIARA Power Banks Recalled", productNames: ["HAIARA Power Banks"], score: 10 }] });
    expect(skipped).toBe(NOT_CHECKED);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const asked = await agencyTier("airbag", { mode: "local", hits: [] }, { timeoutMs: 500 });
    expect(asked.checked).toBe(true);
    expect(asked.hits).toEqual([]);
    expect(asked.note).toMatch(/no recall for these words/);
  });
});
