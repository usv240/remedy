import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moneyWords, recallValue, statedPrices, type ValueRecall } from "@/lib/recall/value";

/** The money headline: units times the lowest stated price, only where a CPSC record states both. */
describe("what the photo-refund recalls are worth to their owners", () => {
  it("reads the prices a Sold At line states, with commas and cents, and no amounts in millions", () => {
    expect(statedPrices(["Amazon.com from April 2025 through June 2026 for between $24 and $34."])).toEqual([24, 34]);
    expect(statedPrices([{ name: "Costco stores for about $1,299.99." }])).toEqual([1299.99]);
    expect(statedPrices(["Sold for $70 for a two-pack; the firm had $10 million in sales"])).toEqual([70]);
    expect(statedPrices([])).toEqual([]);
  });

  it("counts only recalls that state both units and a price, at the lowest price", () => {
    const rs: ValueRecall[] = [
      { number: "1", units: 1000, photoRefund: true, retailers: ["for between $20 and $30."] },
      { number: "2", units: 500, photoRefund: true, retailers: ["Online at shop.example"] },
      { number: "3", units: null, photoRefund: true, retailers: ["for $99."] },
      { number: "4", units: 9999, photoRefund: false, retailers: ["for $5."] },
    ];
    const v = recallValue(rs, 0.06);
    expect(v).toMatchObject({ recalls: 3, covered: 1, units: 1000, lowUsd: 20_000, highUsd: 30_000, unclaimedLowUsd: 18_800, perPointLowUsd: 200 });
  });

  it("rounds the words down, never up", () => {
    expect(moneyWords(1_449_999_999)).toBe("$1.4 billion");
    expect(moneyWords(14_790_000)).toBe("$14.7 million");
    expect(moneyWords(870_400)).toBe("$870,000");
  });

  it("content/recalls/value.json is what the code computes from content/recalls/recalls.json", () => {
    const dir = path.join(process.cwd(), "content", "recalls");
    const data = JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as { recalls: ValueRecall[] };
    const file = JSON.parse(readFileSync(path.join(dir, "value.json"), "utf8"));
    expect(file).toMatchObject(recallValue(data.recalls));
  });
});
