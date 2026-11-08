import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { madeSafeRefund, proofKind, proofSplit, type SplitRecall, type SplitRule } from "@/lib/recall/made-safe";
import { moneyWords, proRated, recallValue, statedPrices, type ValueRecall } from "@/lib/recall/value";

const dir = path.join(process.cwd(), "content", "recalls");
const read = <T>(f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as T;
const data = read<{ recalls: (ValueRecall & SplitRecall)[] }>("recalls.json");
const rules = read<{ rules: Record<string, SplitRule> }>("proof-rules.json").rules;

const rule = (o: Partial<SplitRule>): SplitRule => ({ photo_required: true, actions: ["cut_cord"], must_show: ["whole_product", "cut_or_damage"], remedy: "full_refund", refund_amount: null, refund_amount_text: "a full refund", ...o });

/** What each photo-refund recall's photo is for, read from its proof rule. */
describe("the photo-refund recalls, split by what the photo must show", () => {
  it("a made-safe action makes it made safe; a label or code without one is an identifier photo; the product alone is proof of ownership", () => {
    expect(proofKind(rule({}))).toBe("made_safe");
    expect(proofKind(rule({ actions: [], must_show: ["whole_product", "serial_or_lot"] }))).toBe("identifier");
    expect(proofKind(rule({ actions: [], must_show: ["whole_product"] }))).toBe("product");
    expect(proofKind(rule({ photo_required: false, actions: [], must_show: [] }))).toBe("none");
    // A store credit or gift card for the made-safe photo is not a refund.
    expect(madeSafeRefund(rule({ remedy: "other" }))).toBe(false);
    expect(madeSafeRefund(rule({ remedy: "refund_or_replacement" }))).toBe(true);
  });

  it("matches the recalls the judge named: 25451 and 24281 ask for a photo of the product, not made safe", () => {
    expect(proofKind(rules["25451"])).toBe("product");
    expect(proofKind(rules["24281"])).toBe("product");
    expect(proofKind(rules["24309"])).toBe("made_safe");
  });

  it("content/recalls/proof-split.json is what the code computes, and its parts add up to every photo-refund recall", () => {
    const s = proofSplit(data.recalls, rules);
    expect(read("proof-split.json")).toMatchObject(s);
    expect(s.missingRules).toEqual([]);
    expect(s.madeSafe + s.otherPhoto.count + s.noPhoto.count).toBe(s.photoRefund);
    expect(s.madeSafeRefund.count + s.madeSafeCredit.count).toBe(s.madeSafe);
    expect(s.otherPhoto.product + s.otherPhoto.identifier.count).toBe(s.otherPhoto.count);
    expect(Object.values(s.madeSafeRefund.byYear).reduce((a, b) => a + b, 0)).toBe(s.madeSafeRefund.count);
  });
});

/** The money headline: the refunds the made-safe recalls offer, where a CPSC record states units and a price. */
describe("what the made-safe refund recalls offer their owners", () => {
  it("reads the prices a Sold At line states, with commas and cents, and no amounts in millions", () => {
    expect(statedPrices(["Amazon.com from April 2025 through June 2026 for between $24 and $34."])).toEqual([24, 34]);
    expect(statedPrices([{ name: "Costco stores for about $1,299.99." }])).toEqual([1299.99]);
    expect(statedPrices(["Sold for $70 for a two-pack; the firm had $10 million in sales"])).toEqual([70]);
    expect(statedPrices([])).toEqual([]);
  });

  it("counts only made-safe refunds with units and a price, at the lowest price or the stated amount when lower, and leaves pro-rated refunds out", () => {
    const rs: ValueRecall[] = [
      { number: "1", units: 1000, photoRefund: true, retailers: ["for between $20 and $30."] },
      { number: "2", units: 500, photoRefund: true, retailers: ["Online at shop.example"] },
      { number: "3", units: null, photoRefund: true, retailers: ["for $99."] },
      { number: "4", units: 9999, photoRefund: false, retailers: ["for $5."] },
      { number: "5", units: 100, photoRefund: true, retailers: ["for $50."] },
      { number: "6", units: 100, photoRefund: true, retailers: ["for $80."] },
      { number: "7", units: 100, photoRefund: true, retailers: ["for $60."] },
      { number: "8", units: 100, photoRefund: true, retailers: ["for $60."] },
    ];
    const rr: Record<string, SplitRule> = {
      "1": rule({}),
      "2": rule({}),
      "3": rule({}),
      "4": rule({}),
      // A $10 partial refund on a $50 product counts at $10.
      "5": rule({ remedy: "partial_refund", refund_amount: 10, refund_amount_text: "a $10 refund" }),
      // Pro-rated: no stated share, left out.
      "6": rule({ remedy: "refund_or_replacement", refund_amount_text: "a full or prorated refund" }),
      // A photo of the product only (proof of ownership): not in the headline.
      "7": rule({ actions: [], must_show: ["whole_product"] }),
      // A gift card for the made-safe photo: not a refund.
      "8": rule({ remedy: "other" }),
    };
    const v = recallValue(rs, rr, 0.06);
    expect(v).toMatchObject({ recalls: 5, covered: 2, noPrice: 2, units: 1100, lowUsd: 21_000, highUsd: 31_000, unclaimedLowUsd: 19_740, perPointLowUsd: 210 });
    expect(v.proRated.numbers).toEqual(["6"]);
    expect(v.atStatedAmount.numbers).toEqual(["5"]);
    expect(proRated(rules["25320"])).toBe(true);
  });

  it("rounds the words down, never up", () => {
    expect(moneyWords(1_449_999_999)).toBe("$1.4 billion");
    expect(moneyWords(14_790_000)).toBe("$14.7 million");
    expect(moneyWords(870_400)).toBe("$870,000");
  });

  it("content/recalls/value.json is what the code computes from the recalls and their proof rules", () => {
    const v = recallValue(data.recalls, rules);
    expect(read("value.json")).toMatchObject(v);
    // The money covers exactly the headline's recalls.
    expect(v.recalls).toBe(proofSplit(data.recalls, rules).madeSafeRefund.count);
    expect(v.covered + v.proRated.count + v.noPrice).toBe(v.recalls);
  });
});
