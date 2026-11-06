import { describe, expect, it } from "vitest";
import { canonicalJson, chunks, isoDate, names, officialHashRows, parseUnits, recallRow, ruleAction } from "@/lib/db/load";

describe("the recall loader's mapping", () => {
  it("reads units as the recalls write them", () => {
    expect(parseUnits("About 12,400")).toBe(12400);
    expect(parseUnits("About 1.2 million")).toBe(1_200_000);
    expect(parseUnits("About 3 thousand")).toBe(3000);
    expect(parseUnits(870)).toBe(870);
    expect(parseUnits("")).toBeNull();
    expect(parseUnits("Unknown")).toBeNull();
    expect(parseUnits(-4)).toBeNull();
  });

  it("reads dates in either form", () => {
    expect(isoDate("2026-10-29")).toBe("2026-10-29");
    expect(isoDate("2026-10-29T00:00:00")).toBe("2026-10-29");
    expect(isoDate(new Date("2026-01-02T12:00:00Z"))).toBe("2026-01-02");
    expect(isoDate("not a date")).toBeNull();
    expect(isoDate(undefined)).toBeNull();
  });

  it("reads lists of names as strings or objects", () => {
    expect(names(["Amazon", { Name: "Walmart" }, { name: "Target" }, "", null])).toEqual(["Amazon", "Walmart", "Target"]);
    expect(names("Amazon")).toEqual(["Amazon"]);
    expect(names(undefined)).toEqual([]);
  });

  it("maps a recall to a row, keeping the flags and the photo-refund mark", () => {
    const out = recallRow({
      number: "27056",
      title: "Power Banks Recalled",
      date: "2026-10-29T00:00:00",
      units: "About 12,400",
      hazard: "The power banks can overheat.",
      remedyText: "",
      remedies: ["Refund"],
      products: [{ name: "Power bank", model: "PB-10", description: "", type: "Batteries", units: "About 12,400" }],
      images: [{ url: "https://www.cpsc.gov/i.jpg", caption: "Power bank" }, { url: "" }],
      retailers: [{ Name: "Amazon" }],
      manufacturers: [],
      consumerContact: "recall@example.com",
      url: "https://www.cpsc.gov/Recalls/2026/x",
      photoRefund: true,
      flags: { photo: true, refund: true, marker: true, cut: false, email: true, webmail: true },
    });
    expect("row" in out).toBe(true);
    if (!("row" in out)) return;
    expect(out.row).toMatchObject({ number: "27056", date: "2026-10-29", units: 12400, unitsText: "About 12,400", remedyText: "Refund", photoRefund: true, retailers: ["Amazon"] });
    expect(out.row.images).toEqual([{ url: "https://www.cpsc.gov/i.jpg", caption: "Power bank" }]);
    expect(out.row.flags).toEqual({ photo: true, refund: true, marker: true, cut: false, email: true, webmail: true });
  });

  it("skips a recall it cannot key, and says why", () => {
    expect(recallRow({ title: "x", date: "2026-01-01" })).toEqual({ skip: "no recall number" });
    expect(recallRow({ number: "1", date: "2026-01-01" })).toEqual({ skip: "recall 1 has no title" });
    expect(recallRow({ number: "1", title: "x" })).toEqual({ skip: "recall 1 has no readable date" });
    expect(recallRow(null)).toEqual({ skip: "not an object" });
  });

  it("keeps only well-formed official image hashes", () => {
    const rows = officialHashRows({ "27056": [{ url: "https://a/1.jpg", dhash: "0F0F0F0F0F0F0F0F" }, { url: "https://a/2.jpg", dhash: "xyz" }], "1": "nope" });
    expect(rows).toEqual([{ source: "official", ref: "https://a/1.jpg", recallNumber: "27056", dhash: "0f0f0f0f0f0f0f0f" }]);
  });

  it("keeps a firm's own rule, and refreshes only a changed AI rule", () => {
    const rule = { actions: ["write_recalled"], remedy: "full_refund" };
    expect(ruleAction(null, rule)).toBe("insert");
    expect(ruleAction({ source: "firm", version: 2, rule: {} }, rule)).toBe("keep_firm");
    // Postgres jsonb reorders keys; the comparison does not care.
    expect(ruleAction({ source: "ai", version: 1, rule: { remedy: "full_refund", actions: ["write_recalled"] } }, rule)).toBe("same");
    expect(ruleAction({ source: "ai", version: 1, rule: { ...rule, remedy: "replacement" } }, rule)).toBe("update");
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe('{"a":[2,{"d":3}],"b":1}');
  });

  it("splits a list into chunks", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 3)).toEqual([]);
  });
});
