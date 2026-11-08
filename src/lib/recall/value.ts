/**
 * What the photo-refund recalls are worth to their owners, from the CPSC records alone: each recall's US units times
 * the sale price its record states in its Sold At field ("Amazon.com ... for between $24 and $34."). Only recalls whose
 * record states both count; a price range is taken at its lowest price, so the figure is a floor, not an estimate.
 * Nothing is extrapolated to recalls that state no price. Pure.
 */
export type ValueRecall = { number: string; units: number | null; photoRefund: boolean; retailers?: (string | { name?: string; Name?: string })[] };

/** Every dollar amount in the record's Sold At field (the CPSC's Retailers), in dollars: the prices it sold for. */
export function statedPrices(retailers: ValueRecall["retailers"]): number[] {
  const text = (retailers ?? []).map((r) => (typeof r === "string" ? r : (r.name ?? r.Name ?? ""))).join(" ");
  return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d.,]*\d|\s*(?:million|billion))/gi)].map((m) => Number(m[1].replace(/,/g, "")) + (m[2] ? Number(`0.${m[2]}`) : 0)).filter((n) => n > 0);
}

export type RecallValue = {
  /** Photo-refund recalls in the data, and how many state both units and a price. */
  recalls: number;
  covered: number;
  units: number;
  /** Units times the lowest stated price, and times the highest, in whole dollars. */
  lowUsd: number;
  highUsd: number;
  /** At the share that comes back (6 in 100), what stays with owners unclaimed, at the lowest price. */
  comeBackShare: number;
  unclaimedLowUsd: number;
  /** What one more point of return (1 in 100 more units) sends back to owners, at the lowest price. */
  perPointLowUsd: number;
  /** The largest single recalls by low value, for the method page. */
  largest: { number: string; units: number; price: number; usd: number }[];
};

export function recallValue(recalls: ValueRecall[], comeBackShare = 0.06): RecallValue {
  const pr = recalls.filter((r) => r.photoRefund);
  const rows = pr
    .map((r) => ({ r, prices: statedPrices(r.retailers) }))
    .filter((x) => x.r.units && x.r.units > 0 && x.prices.length)
    .map((x) => ({ number: x.r.number, units: x.r.units!, low: Math.min(...x.prices), high: Math.max(...x.prices) }));
  const low = rows.reduce((s, x) => s + x.units * x.low, 0);
  const high = rows.reduce((s, x) => s + x.units * x.high, 0);
  return {
    recalls: pr.length,
    covered: rows.length,
    units: rows.reduce((s, x) => s + x.units, 0),
    lowUsd: Math.round(low),
    highUsd: Math.round(high),
    comeBackShare,
    unclaimedLowUsd: Math.round(low * (1 - comeBackShare)),
    perPointLowUsd: Math.round(low * 0.01),
    largest: rows
      .map((x) => ({ number: x.number, units: x.units, price: x.low, usd: Math.round(x.units * x.low) }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 5),
  };
}

/** "$41.2 million" or "$870,000": plain, rounded down to what the data supports. */
export function moneyWords(usd: number): string {
  if (usd >= 1e9) return `$${(Math.floor(usd / 1e8) / 10).toFixed(1)} billion`;
  if (usd >= 1e6) return `$${(Math.floor(usd / 1e5) / 10).toFixed(1)} million`;
  return `$${(Math.floor(usd / 1000) * 1000).toLocaleString("en-US")}`;
}
