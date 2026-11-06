import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeMatch, keywordScore, normalizeItem, scanCatalog, scanCsv, MATCH, REVIEW, SCAN_LIMITS } from "@/lib/recall/scan";
import { parseCatalogCsv } from "@/lib/recall/scan-csv";
import { CLEAR_ITEMS, sampleCatalog } from "@/lib/recall/scan-sample";
import { tokens } from "@/lib/recall/search";

// No Elastic, no database, no AI key: the in-app ranking and the keyword score only. Ambiguous rows stay unknown.
const saved = { ...process.env };
beforeEach(() => {
  for (const k of ["ELASTIC_URL", "ELASTIC_API_KEY", "DATABASE_URL", "ANTHROPIC_API_KEY"]) delete process.env[k];
});
afterEach(() => {
  process.env = { ...saved };
});

describe("catalog scan", () => {
  it("finds the demo recalls by their words and leaves everyday items clear", async () => {
    const r = await scanCatalog([
      { name: "HAIARA 10000mAh power bank", brand: "HAIARA" },
      { name: "Wantefully hair dryer brush", brand: "Wantefully" },
      { name: "QZH.DUAO children's pajamas" },
      ...CLEAR_ITEMS,
    ]);
    expect(r.summary.total).toBe(6);
    const by = Object.fromEntries(r.results.map((x) => [x.item.name, x]));
    expect(by["HAIARA 10000mAh power bank"].status).toBe("photo_refund");
    expect(by["HAIARA 10000mAh power bank"].recall?.number).toBe("27056");
    expect(by["HAIARA 10000mAh power bank"].claim_url).toBe("/claim/27056");
    expect(by["HAIARA 10000mAh power bank"].recall?.remedy_summary).toContain("Write RECALLED");
    expect(by["Wantefully hair dryer brush"].recall?.number).toBe("26754");
    expect(by["QZH.DUAO children's pajamas"].recall?.number).toBe("27045");
    for (const c of CLEAR_ITEMS) expect(by[c.name].status, c.name).toBe("clear");
    expect(r.summary.photo_refund).toBe(3);
    expect(r.summary.clear).toBe(3);
    expect(r.ai.used).toBe(false);
    expect(r.search.mode).toBe("local");
  });

  it("the sample catalog is real recalls plus the clear items, and scans as such", async () => {
    const s = sampleCatalog();
    expect(s.items.length).toBeGreaterThanOrEqual(6);
    expect(s.items.slice(-3)).toEqual(CLEAR_ITEMS);
    const r = await scanCatalog(s.items);
    expect(r.summary.photo_refund).toBeGreaterThanOrEqual(3);
    expect(r.summary.clear).toBe(3);
    // Every matched row names a real recall with a page and the CPSC's own link.
    for (const x of r.results.filter((x) => x.recall)) {
      expect(x.recall!.page).toBe(`/recalls/${x.recall!.number}`);
      expect(x.recall!.cpsc_url).toMatch(/^https:\/\/(www\.)?cpsc\.gov\//);
    }
  });

  it("a stated model in the recall's own list settles the row without words", async () => {
    // Recall 27056's models include the power bank's model code.
    const r = await scanCatalog([{ name: "portable charger", model: "HA-PB-10K" }]);
    // Whatever the model code is in the data, a code that is absent must not match by model.
    expect(r.results[0].matched_by).not.toBe("model");
    expect(codeMatch({ name: "x", model: "AB-123", sku: null, brand: null }, { models: "modelsab123andab124", upcs: new Set() })).toBe("model");
    expect(codeMatch({ name: "x", model: "AB", sku: null, brand: null }, { models: "ab", upcs: new Set() })).toBeNull();
    expect(codeMatch({ name: "x", model: null, sku: "0123456789012", brand: null }, { models: "", upcs: new Set(["0123456789012"]) })).toBe("upc");
  });

  it("the keyword score covers the row's words and halves when a given brand is absent", () => {
    const cand = new Set(tokens("HAIARA Power Banks HAIARA Power Banks Recalled Mitrytech"));
    expect(keywordScore({ name: "HAIARA power bank", model: null, sku: null, brand: null }, cand)).toBe(1);
    // "Anker power bank": two of three words covered (0.67), halved because the brand is absent.
    expect(keywordScore({ name: "power bank", model: null, sku: null, brand: "Anker" }, cand)).toBe(0.33);
    expect(keywordScore({ name: "", model: null, sku: null, brand: null }, cand)).toBe(0);
    expect(MATCH).toBeGreaterThan(REVIEW);
  });

  it("rows with no name are unknown, repeats share one search, and the limit holds", async () => {
    const r = await scanCatalog([{ name: "   " }, { name: "HAIARA power bank" }, { name: "HAIARA power bank" }]);
    expect(r.results[0].status).toBe("unknown");
    expect(r.results[1].recall?.number).toBe(r.results[2].recall?.number);
    expect(normalizeItem({ name: "  a  b ", model: " M1 ", sku: "", brand: null })).toEqual({ name: "a b", model: "M1", sku: null, brand: null });
    expect(SCAN_LIMITS.maxItems).toBe(500);
    expect(SCAN_LIMITS.freeItems).toBe(50);
  });

  it("writes the results as a CSV with the claim link on this server", async () => {
    const r = await scanCatalog([{ name: "HAIARA power bank" }, { name: 'Mug, "stoneware" 12 oz' }]);
    const csv = scanCsv(r, "https://remedy.example");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("row,name,model,sku,brand,status,confidence,matched_by,recall_number,recall_title,recall_date,remedy,refund_amount,claim_url,cpsc_url,reason");
    expect(lines[1]).toContain("https://remedy.example/claim/27056");
    expect(lines[2]).toContain('"Mug, ""stoneware"" 12 oz"');
  });
});

describe("catalog CSV", () => {
  it("reads loose headers, a BOM and quoted fields", () => {
    const p = parseCatalogCsv('﻿Product Title,Model Number,UPC,Manufacturer\n"Power bank, 10000mAh",PB-10,012345678905,HAIARA\nTowel,,,\n');
    expect(p.items).toEqual([
      { name: "Power bank, 10000mAh", model: "PB-10", sku: "012345678905", brand: "HAIARA" },
      { name: "Towel", model: "", sku: "", brand: "" },
    ]);
    expect(p.total).toBe(2);
    expect(p.warnings).toEqual([]);
  });
  it("reads a file with no header as one product per line", () => {
    const p = parseCatalogCsv("HAIARA power bank\nSpace heater,DR-HSH015\n");
    expect(p.items).toEqual([
      { name: "HAIARA power bank", model: undefined },
      { name: "Space heater", model: "DR-HSH015" },
    ]);
    expect(p.warnings[0]).toMatch(/No name column/);
  });
  it("leaves out nameless lines, keeps the first N, and says so", () => {
    const p = parseCatalogCsv("name,sku\n,x\nA,1\nB,2\nC,3\n", 2);
    expect(p.items.map((i) => i.name)).toEqual(["A", "B"]);
    expect(p.warnings.join(" ")).toMatch(/1 line has no product name/);
    expect(p.warnings.join(" ")).toMatch(/first 2 rows/);
    expect(parseCatalogCsv("   ").warnings).toEqual(["The file is empty."]);
  });
});
