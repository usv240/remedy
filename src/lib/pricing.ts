import { PROBLEM } from "./research";

/**
 * Who pays Remedy: the recalling firm, a fee per finished claim. The fee is a proposal, not a price anyone pays today,
 * and every page that names it says so. It is set beside what a firm spends per refund today, from published sources
 * (src/lib/research.ts): a paper check costs its issuer $2 to $4, and a PayPal payout costs the sender $0.25.
 * tests/facts.test.ts checks that the README and /evidence/market print these same words.
 */
export const PROPOSED_FEE = {
  cents: 100,
  usd: "$1.00",
  label: "proposed",
} as const;

const dollars = (s: string) => Number(s.replace(/[^0-9.]/g, ""));

/** The firm's cost per refund with Remedy (the proposed fee plus PayPal's payout fee), beside a paper check's. */
export function perRefund() {
  const payout = dollars(PROBLEM.payoutFee.fee);
  const withRemedy = PROPOSED_FEE.cents / 100 + payout;
  const [lo, hi] = PROBLEM.checkCost.cost.split(/\s+to\s+/).map(dollars);
  return {
    fee: PROPOSED_FEE.usd,
    payoutFee: PROBLEM.payoutFee.fee,
    withRemedy: `$${withRemedy.toFixed(2)}`,
    check: PROBLEM.checkCost.cost,
    checkLow: lo,
    checkHigh: hi,
    /** One sentence for every page that names the fee. */
    sentence: `Proposed: ${PROPOSED_FEE.usd} per finished claim (a proposal, not a price list), so a refund costs the firm $${withRemedy.toFixed(2)} with PayPal's ${PROBLEM.payoutFee.fee} payout fee, against the ${PROBLEM.checkCost.cost} a paper check costs its issuer today.`,
  };
}
