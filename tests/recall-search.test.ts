import { describe, expect, it } from "vitest";
import { loadRecalls, localSearch, matchesFilters, recallDoc, searchRecalls, tokens } from "@/lib/recall/search";

const has = (re: RegExp) => (h: { title: string; productNames: string[] }) => re.test(`${h.productNames.join(" ")} ${h.title}`);

describe("in-app BM25 over recalls.json", () => {
  it("space heater: space heaters first", () => {
    const hits = localSearch("space heater", { k: 3 });
    expect(hits.length).toBe(3);
    expect(has(/space heater/i)(hits[0])).toBe(true);
    expect(hits.every(has(/heater/i))).toBe(true);
  });
  it("power bank: power banks first", () => {
    const hits = localSearch("power bank", { k: 5 });
    expect(hits.every(has(/power bank/i))).toBe(true);
  });
  it("pajamas: pajama recalls first", () => {
    const hits = localSearch("pajamas", { k: 5 });
    expect(hits.every(has(/pajama/i))).toBe(true);
  });
  it("nursing pillow: nursing pillows first", () => {
    const hits = localSearch("nursing pillow", { k: 3 });
    expect(hits.every(has(/nursing pillow/i))).toBe(true);
  });
  it("filters by photo refund and year", () => {
    const hits = localSearch("power bank", { k: 10, filters: { photoRefund: true, year: 2026 } });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.photoRefund && h.date.startsWith("2026"))).toBe(true);
  });
  it("an empty or stop-word query returns nothing", () => {
    expect(localSearch("   ")).toEqual([]);
    expect(localSearch("the and recall")).toEqual([]);
  });
});

describe("search pieces", () => {
  it("tokens strip simple plurals", () => {
    expect(tokens("Space Heaters")).toEqual(["space", "heater"]);
    expect(tokens("batteries")).toEqual(["battery"]);
    expect(tokens("Pajamas")).toEqual(["pajama"]);
  });
  it("matchesFilters", () => {
    const r = { photoRefund: true, date: "2026-10-29", category: "Heaters" };
    expect(matchesFilters(r, {})).toBe(true);
    expect(matchesFilters(r, { photoRefund: false })).toBe(false);
    expect(matchesFilters(r, { year: "2025" })).toBe(false);
    expect(matchesFilters(r, { category: "heaters" })).toBe(true);
  });
  it("indexes a short summary for the reranker", () => {
    const d = recallDoc(loadRecalls().find((r) => r.number === "27045")!);
    expect(d.summary).toMatch(/Pajama/i);
    expect(d.year).toBe(2026);
    expect(d.photoRefund).toBe(true);
  });
  it("searchRecalls uses the in-app ranking when Elastic is not set", async () => {
    const saved = { url: process.env.ELASTIC_URL, key: process.env.ELASTIC_API_KEY };
    delete process.env.ELASTIC_URL;
    delete process.env.ELASTIC_API_KEY;
    try {
      const r = await searchRecalls("nursing pillow", { k: 3 });
      expect(r.mode).toBe("local");
      expect(r.hits.every(has(/nursing pillow/i))).toBe(true);
    } finally {
      if (saved.url !== undefined) process.env.ELASTIC_URL = saved.url;
      if (saved.key !== undefined) process.env.ELASTIC_API_KEY = saved.key;
    }
  });
});
