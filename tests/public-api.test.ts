import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import stats from "../content/recalls/stats.json";
import { explore } from "@/lib/api/explore";
import { ENDPOINTS, v1Index } from "@/lib/api/endpoints";
import { fmtDate, fmtMs, fmtUnits, shortTitle } from "@/lib/api/format";
import { openapi } from "@/lib/api/openapi";
import { extractionTrace, filtersFrom, findRecalls, normalizeNumber, recallDetail, storedRule } from "@/lib/api/recall-data";
import { actionLabel, percent, ruleChips } from "@/lib/api/rule-chips";
import { ProofRuleRequest } from "@/lib/api/v1-schemas";
import { verifyBody, verifyForApi, verifyMode } from "@/lib/api/verify-service";
import { TOOLS } from "@/lib/mcp/tools";
import { STOPS } from "@/components/tour/stops";

// Unit tests run without Elastic, a database or an AI key: search uses the in-app ranking, verify the free checks.
const saved = { ...process.env };
beforeEach(() => {
  for (const k of ["ELASTIC_URL", "ELASTIC_API_KEY", "DATABASE_URL", "ANTHROPIC_API_KEY"]) delete process.env[k];
});
afterEach(() => {
  process.env = { ...saved };
});

describe("proof-rule chips", () => {
  it("say what to do, what to show and what you get, in that order", () => {
    const r = { photo_required: true, actions: ["write_recalled"], marker_text: "recalled", must_show: ["whole_product", "marking", "label"], remedy: "full_refund", refund_amount: null, refund_amount_text: null, steps: [] };
    expect(ruleChips(r)).toEqual(["Write RECALLED", "Photo of label", "Full refund"]);
    expect(ruleChips({ ...r, actions: ["cut_cord"], must_show: [], refund_amount: 25 })).toEqual(["Cut the cord", "$25 refund"]);
    expect(ruleChips(null)).toEqual([]);
    expect(actionLabel("write_recalled", { marker_text: null })).toBe("Write RECALLED");
    expect(percent(0.934)).toBe("93%");
  });

  it("match the stored rule for the power bank recall 27056", () => {
    const rule = storedRule("27056")!.rule;
    expect(ruleChips(rule)).toContain("Write RECALLED");
    expect(ruleChips(rule).at(-1)).toBe("Full refund");
  });
});

describe("recall formatting", () => {
  it("shortens CPSC titles to what was recalled", () => {
    expect(shortTitle("HAIARA Power Banks Recalled Due to Risk of Serious Injury or Death from Fire and Burn Hazards; Sold on Amazon.com by Mitrytech")).toBe("HAIARA Power Banks");
    expect(shortTitle("DREO Recalls DR-HSH015 Space Heaters Due to Fire and Burn Hazards")).toBe("DREO DR-HSH015 Space Heaters");
    expect(fmtDate("2026-10-29")).toBe("Oct 29, 2026");
    expect(fmtUnits(11000)).toBe("11,000 units");
    expect(fmtUnits(null)).toBe("Units not given");
    expect(fmtMs(14827)).toBe("14.8 s");
  });

  it("reads a recall number in the forms people write it", () => {
    expect(normalizeNumber("27056")).toBe("27056");
    expect(normalizeNumber("27-056")).toBe("27056");
    expect(normalizeNumber("Recall 27056")).toBe("27056");
    expect(normalizeNumber("https://www.cpsc.gov/Recalls/2027/HAIARA-Power-Banks 27-056")).toBe("27056");
  });
});

describe("recall search and filters", () => {
  it("parses the query string, ignoring unknown values", () => {
    const f = filtersFrom(new URLSearchParams("query=space heater&photo_refund=true&year=2026&remedy=refund&units=bogus&limit=500"));
    expect(f.query).toBe("space heater");
    expect(f.filters).toMatchObject({ photoRefund: true, year: "2026", remedy: "refund", units: undefined });
    expect(f.limit).toBe(100);
  });

  it("finds the demo recalls for plain-language queries without Elastic", async () => {
    for (const [q, n] of [
      ["power bank", "27056"],
      ["pajama set", "27045"],
      ["hair dryer brush", "26754"],
    ] as const) {
      const r = await findRecalls({ query: q, filters: { photoRefund: true }, limit: 5 });
      expect(r.mode).toBe("local");
      expect(r.hits.map((h) => h.number), q).toContain(n);
    }
  });

  it("lists every photo-refund recall, newest first, matching stats.json", async () => {
    const r = await findRecalls({ filters: { photoRefund: true }, limit: 3 });
    expect(r.total).toBe(stats.current.all.photoRefund.count);
    expect(r.hits[0].date >= r.hits[1].date).toBe(true);
    const all = await explore({ query: "", filters: {}, show: 20 });
    expect(all.counts.all).toBe(stats.current.recalls.count);
    expect(all.counts.photo).toBe(stats.current.all.photoRefund.count);
    expect(all.hits).toHaveLength(20);
  });

  it("returns one recall with its images, remedy and proof rule", () => {
    const d = recallDetail("27056")!;
    expect(d.remedy_text).toContain("permanent marker");
    expect(d.images.length).toBeGreaterThan(0);
    expect(d.proof_rule?.actions).toContain("write_recalled");
    expect(d.claim_page).toBe("/claim/27056");
    expect(recallDetail("99999")).toBeNull();
    expect(extractionTrace("27056")?.checked?.rule).toBeTruthy();
  });
});

describe("the public API description", () => {
  it("lists the product endpoints in OpenAPI with their parameters and bodies", () => {
    const spec = openapi("https://remedy.example") as { paths: Record<string, Record<string, { parameters?: { name: string }[]; requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> } }>> };
    for (const p of ["/api/v1/recalls", "/api/v1/recalls/{number}", "/api/v1/proof-rule", "/api/v1/verify", "/api/v1/claims", "/api/v1/claims/{id}", "/api/v1/claims/{id}/pay", "/api/v1/claims/{id}/replacements"]) expect(spec.paths[p], p).toBeDefined();
    expect(spec.paths["/api/v1/recalls"].get.parameters?.map((x) => x.name)).toContain("photo_refund");
    expect(spec.paths["/api/v1/recalls/{number}"].get.parameters?.[0].name).toBe("number");
    expect(Object.keys(spec.paths["/api/v1/verify"].post.requestBody!.content["multipart/form-data"].schema.properties!)).toEqual(["photo", "recall_number", "amount"]);
    expect(spec.paths["/api/v1/proof-rule"].post.requestBody!.content["application/json"].schema.properties).toHaveProperty("remedy_text");
    expect(ENDPOINTS.every((e) => e.summary.length > 20 && !/—/.test(e.summary))).toBe(true);
  });

  it("takes a recall number or a remedy text for a proof rule, never both", () => {
    expect(ProofRuleRequest.safeParse({ recall_number: "27056" }).success).toBe(true);
    expect(ProofRuleRequest.safeParse({ remedy_text: "Consumers should cut the cord and email a photo for a full refund." }).success).toBe(true);
    expect(ProofRuleRequest.safeParse({}).success).toBe(false);
    expect(ProofRuleRequest.safeParse({ recall_number: "27056", remedy_text: "Consumers should cut the cord and email a photo." }).success).toBe(false);
  });
});

const official = () => readFileSync(path.join(process.cwd(), "content", "verify", "fixtures", "official", "27056-haiara-1.jpg"));

describe("photo verification for the API", () => {
  it("runs only the free checks without a key, and asks for the owner's own photo", async () => {
    const m = await verifyMode(null, "v1.verify");
    expect(m.mode).toBe("free");
    const v = await verifyForApi({ photo: official(), recallNumber: "27056", mode: "free" });
    const body = verifyBody(v, m.mode, m.note, "x");
    expect(body.decision).toBe("retake");
    expect(body.decided_by).toBe("own_photo");
    expect(body.checks.C3.status).toBe("fail");
    expect(body.payment).toBeNull();
    expect(v.result.usage.vision).toBeNull();
  });

  it("says plainly when the recall is unknown or the photo is empty", async () => {
    await expect(verifyForApi({ photo: official(), recallNumber: "99999", mode: "free" })).rejects.toThrow(/no recall 99999/);
    await expect(verifyForApi({ photo: new Uint8Array(), recallNumber: "27056", mode: "free" })).rejects.toThrow(/empty/);
  });
});

describe("the MCP tools", () => {
  const ctx = { origin: "https://remedy.example", keyId: null, auth: null };
  const run = (name: string, input: unknown) => (TOOLS.find((t) => t.name === name)!.run as (i: unknown, c: typeof ctx) => Promise<{ text: string; data?: Record<string, unknown>; isError?: boolean }>)(input, ctx);

  it("the recorded session on /developers runs the whole loop: the recall, verify_photo on the replayed verdict, the claim, ready to pay", () => {
    // content/public/mcp-session.json is written by scripts/public/record-mcp-session.mjs against a running server with no Claude key.
    const s = JSON.parse(readFileSync(path.join(process.cwd(), "content", "public", "mcp-session.json"), "utf8")) as { note: string; steps: { tool: string; text: string; isError: boolean }[] };
    const tools = s.steps.map((x) => x.tool);
    expect(tools).toEqual(["search_recalls", "get_proof_rule", "open_claim", "verify_photo", "open_claim", "claim_status"]);
    expect(s.steps.every((x) => !x.isError)).toBe(true);
    const verify = s.steps.find((x) => x.tool === "verify_photo")!;
    expect(verify.text).toMatch(/^Verified\./);
    expect(verify.text).toMatch(/verification cache/);
    expect(s.steps.at(-1)!.text).toMatch(/: verified\./);
    expect(s.steps.at(-1)!.text).toMatch(/Ready to pay: \$34\.99/);
    expect(s.note).toMatch(/no AI model was called/);
  });

  it("are the five plan tools, the catalog scan, the label check and ping, each with a schema and plain description", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(["check_label", "claim_status", "get_proof_rule", "open_claim", "ping", "scan_catalog", "search_recalls", "verify_photo"]);
    for (const t of TOOLS) expect(t.description).not.toMatch(/—|\bfraud|\bfake/i);
    expect(TOOLS.find((t) => t.name === "open_claim")!.changes).toBeTruthy();
  });

  it("search, read a rule, verify a photo and give the claim link", async () => {
    const s = await run("search_recalls", { query: "power bank", photo_refund: true, limit: 3 });
    expect(s.text).toContain("27056");
    const g = await run("get_proof_rule", { recall_number: "27056" });
    expect(g.text).toMatch(/Write RECALLED/);
    expect(g.data?.source).toBe("stored");
    const b64 = official().toString("base64");
    const v = await run("verify_photo", { recall_number: "27056", image_base64: `data:image/jpeg;base64,${b64}` });
    expect(v.data?.decision).toBe("retake");
    const o = await run("open_claim", { recall_number: "27056" });
    expect(o.data?.claim_link).toBe("https://remedy.example/claim/27056");
    expect(o.data?.opened).toBe(false);
    expect(o.text).toContain("sandbox");
    const missing = await run("get_proof_rule", { recall_number: "99999" });
    expect(missing.isError).toBe(true);
  });
});

describe("the guided tour", () => {
  it("has short stops on real pages, each with a target", () => {
    expect(STOPS.length).toBeGreaterThanOrEqual(5);
    for (const s of STOPS) {
      expect(s.path.startsWith("/")).toBe(true);
      expect(s.target).toBeTruthy();
      expect(s.text.length).toBeLessThan(220);
      expect(JSON.stringify(s)).not.toMatch(/—/);
    }
  });
});

describe("GET /api/v1, the index of the v1 endpoints", () => {
  it("lists every v1 endpoint from the same ENDPOINTS list the docs and the playground read, each with its docs link", () => {
    const idx = v1Index("https://remedy.example");
    const v1 = ENDPOINTS.filter((e) => e.path.startsWith("/api/v1/"));
    expect(idx.endpoints.map((e) => [e.method, e.path])).toEqual(v1.map((e) => [e.method, e.path]));
    expect(idx.endpoints.length).toBeGreaterThan(8);
    for (const e of idx.endpoints) {
      expect(e.docs).toBe(`https://remedy.example/developers/docs#${e.id}`);
      expect(e.summary).toMatch(/^[A-Z].*\.$/);
    }
    expect(idx).toMatchObject({ docs: "https://remedy.example/developers/docs", openapi: "https://remedy.example/openapi.json", mcp: "https://remedy.example/api/mcp" });
    // The route serves exactly this index, in the API's usual envelope.
    const route = readFileSync(path.join(process.cwd(), "src", "app", "api", "v1", "route.ts"), "utf8");
    expect(route).toContain("ok(v1Index(publicOrigin(req)), started)");
  });
});
