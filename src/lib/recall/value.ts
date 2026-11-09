/**
 * What the photo-refund recalls offer their owners in refunds, from the CPSC records and the proof rules alone. Only the
 * recalls whose rule asks for a photo of the product made safe and pays a refund in money count (madeSafeRefund in
 * src/lib/recall/made-safe.ts). Each counts as its US units times the refund for one unit: the sale price its record
 * states in its Sold At field ("Amazon.com ... for between $24 and $34."), taken at its lowest, or the fixed amount its
 * rule states when that is lower, so the figure is a floor, never an estimate. A pro-rated refund states no share of
 * the price, so it is left out, as are recalls whose record states no units or no price. Pure.
 */
import { madeSafeRefund, type SplitRule } from "./made-safe";

export type ValueRecall = { number: string; units: number | null; photoRefund: boolean; retailers?: (string | { name?: string; Name?: string })[] };

/** Every dollar amount in the record's Sold At field (the CPSC's Retailers), in dollars: the prices it sold for. */
export function statedPrices(retailers: ValueRecall["retailers"]): number[] {
  const text = (retailers ?? []).map((r) => (typeof r === "string" ? r : (r.name ?? r.Name ?? ""))).join(" ");
  return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d.,]*\d|\s*(?:million|billion))/gi)].map((m) => Number(m[1].replace(/,/g, "")) + (m[2] ? Number(`0.${m[2]}`) : 0)).filter((n) => n > 0);
}

/** A refund the rule says is pro-rated (by age or purchase date): it states no share of the price to count. */
export const proRated = (rule: Pick<SplitRule, "remedy" | "refund_amount" | "refund_amount_text">) =>
  /pro-?rated/i.test(rule.refund_amount_text ?? "") || (rule.remedy === "partial_refund" && rule.refund_amount === null);

export type RecallValue = {
  /** Recalls that refund an owner for a photo of the product made safe, and how many of them are counted. */
  recalls: number;
  covered: number;
  /** Left out: a pro-rated refund (no stated share), and no units or no price in the record. */
  proRated: { count: number; numbers: string[] };
  noPrice: number;
  /** Counted at the fixed amount their rule states, because it is under the lowest stated price. */
  atStatedAmount: { count: number; numbers: string[] };
  units: number;
  /** Units times the refund for one unit at the lowest stated price, and at the highest, in whole dollars. */
  lowUsd: number;
  highUsd: number;
  /**
   * What stays with owners unclaimed, at the lowest price, at two published rates that measure different things:
   * `comeBackShare` (6 in 100) is the share of recalled units that come back; `correctionRate` (the CPSC's FY2025
   * 44.55%) is an average correction rate across recalls, under a method revised in FY2024. Shown as a range.
   */
  comeBackShare: number;
  unclaimedLowUsd: number;
  correctionRate: number;
  unclaimedAtCorrectionLowUsd: number;
  /** What one more point of return (1 in 100 more units) sends back to owners, at the lowest price. */
  perPointLowUsd: number;
  /** The largest single recalls by low value, for the method page. `price` is the refund counted for one unit. */
  largest: { number: string; units: number; price: number; usd: number }[];
  /**
   * How concentrated the total is: the two largest recalls' share of lowUsd (a percent, one decimal), and the median
   * recall's value at the lowest price across the counted recalls, in whole dollars.
   */
  concentration: { topTwoUsd: number; topTwoShare: number; medianUsd: number };
};

/** The CPSC's FY2025 average correction rate across recalls, as a share (PROBLEM.correctionRate.rate in src/lib/research.ts). */
export const CORRECTION_RATE = 0.4455;

export function recallValue(recalls: ValueRecall[], rules: Record<string, SplitRule>, comeBackShare = 0.06, correctionRate = CORRECTION_RATE): RecallValue {
  const pr = recalls.filter((r) => r.photoRefund && rules[r.number] && madeSafeRefund(rules[r.number]));
  const pro = pr.filter((r) => proRated(rules[r.number]));
  const rest = pr.filter((r) => !proRated(rules[r.number]));
  const rows = rest
    .map((r) => ({ r, prices: statedPrices(r.retailers), amount: rules[r.number].refund_amount }))
    .filter((x) => x.r.units && x.r.units > 0 && x.prices.length)
    .map((x) => {
      const low = Math.min(...x.prices);
      const high = Math.max(...x.prices);
      const a = x.amount !== null && x.amount > 0 ? x.amount : null;
      return { number: x.r.number, units: x.r.units!, low: a !== null ? Math.min(low, a) : low, high: a !== null ? Math.min(high, a) : high, byAmount: a !== null && a < low };
    });
  const low = rows.reduce((s, x) => s + x.units * x.low, 0);
  const high = rows.reduce((s, x) => s + x.units * x.high, 0);
  const byAmount = rows.filter((x) => x.byAmount);
  const byValue = rows.map((x) => ({ number: x.number, units: x.units, price: x.low, usd: Math.round(x.units * x.low) })).sort((a, b) => b.usd - a.usd);
  return {
    recalls: pr.length,
    covered: rows.length,
    proRated: { count: pro.length, numbers: pro.map((r) => r.number) },
    noPrice: rest.length - rows.length,
    atStatedAmount: { count: byAmount.length, numbers: byAmount.map((x) => x.number) },
    units: rows.reduce((s, x) => s + x.units, 0),
    lowUsd: Math.round(low),
    highUsd: Math.round(high),
    comeBackShare,
    unclaimedLowUsd: Math.round(low * (1 - comeBackShare)),
    correctionRate,
    unclaimedAtCorrectionLowUsd: Math.round(low * (1 - correctionRate)),
    perPointLowUsd: Math.round(low * 0.01),
    largest: byValue.slice(0, 5),
    concentration: {
      topTwoUsd: byValue.slice(0, 2).reduce((s, x) => s + x.usd, 0),
      topTwoShare: low ? Math.round((byValue.slice(0, 2).reduce((s, x) => s + x.usd, 0) / Math.round(low)) * 1000) / 10 : 0,
      medianUsd: median(byValue.map((x) => x.units * x.price)),
    },
  };
}

/** The middle value, the mean of the two middle ones for an even count, in whole dollars. */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

/** "$41.2 million" or "$870,000": plain, rounded down to what the data supports. */
export function moneyWords(usd: number): string {
  if (usd >= 1e9) return `$${(Math.floor(usd / 1e8) / 10).toFixed(1)} billion`;
  if (usd >= 1e6) return `$${(Math.floor(usd / 1e5) / 10).toFixed(1)} million`;
  return `$${(Math.floor(usd / 1000) * 1000).toLocaleString("en-US")}`;
}
