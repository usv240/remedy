/**
 * The one-click sandbox payout on /try: after Brightline's sample charger checks out, "Send $34.99 to the sandbox buyer"
 * makes a real PayPal sandbox payout to the sandbox personal account TESTING.md publishes, through the same router and
 * payouts code every claim uses (planPayment, then payClaims: one Payouts batch), and opens the receipt with PayPal's
 * payout_batch_id and live status. It is a sandbox payout: practice money, never a real one. Server only.
 *
 * Limits, in this order, each checked before anything is sent:
 * 1. the sandbox's daily ceiling every payment shares (LIMITS.perDayCents over the last 24 hours, src/lib/payments);
 * 2. one per visitor a day (TRY_PAYOUT.perVisitorPerDay);
 * 3. TRY_PAYOUT.perDay for the whole site, kept well inside that ceiling so the firm console's payouts still fit.
 * When one is reached, nothing is sent and the most recent sandbox payout's receipt is shown instead.
 */
import { LIMITS } from "@/lib/payments/deps";
import { SHOP } from "@/lib/payments/shop-catalog";

export const TRY_PAYOUT = {
  /** The sample charger's refund: the sample shop's price, what Brightline's sample recall pays. */
  amountCents: SHOP.product.priceCents,
  perVisitorPerDay: 1,
  perDay: 6,
  /** The preset this payout follows: Brightline's sample charger with its cord cut, verified. */
  preset: "sample-charger-cut",
  label: "Sandbox payout",
} as const;

// The site-wide count is kept well inside the shared sandbox ceiling, so the firm console's payouts still fit.
if (TRY_PAYOUT.perDay * TRY_PAYOUT.amountCents > LIMITS.perDayCents / 2) throw new Error("TRY_PAYOUT.perDay must stay inside half the sandbox's daily ceiling.");

export type TryReceipt = { claimId: string; url: string; batchId: string | null; itemId: string | null; status: string | null; statusPlain: string | null; at: string | null };
export type TryPayoutResult =
  | { sent: true; label: string; amount: string; payee: string; plain: string; receipt: TryReceipt }
  | { sent: false; label: string; reason: "ceiling" | "visitor" | "day" | "no_payee" | "not_sent"; plain: string; receipt: TryReceipt | null };

export type TryPayoutDeps = {
  /** The sandbox personal account to pay (SANDBOX_BUYER_EMAIL, else the login TESTING.md publishes). */
  payee: () => Promise<string | null>;
  /** What every payment has sent in the last 24 hours, in cents: the router's own ceiling count. */
  paidLast24hCents: () => Promise<number>;
  /** One use of a rate bucket; false when it is used up. */
  allow: (bucket: string, limit: number) => Promise<boolean>;
  /** The most recent sandbox payout this page sent. */
  latestReceipt: () => Promise<TryReceipt | null>;
  /** Open the verified sample claim the payout pays; returns its id. */
  openClaim: (o: { amountCents: number }) => Promise<string>;
  /** Pay it through the router and the payouts code; returns the receipt as PayPal answered. */
  pay: (claimId: string, payee: string) => Promise<{ ok: boolean; plain: string; receipt: TryReceipt }>;
  /** The payee as the page shows it. */
  mask: (payee: string) => string;
};

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Send the one-click sandbox payout, or say why not and show the most recent receipt. */
export async function sendTryPayout(o: { visitorKey: string }, d: TryPayoutDeps): Promise<TryPayoutResult> {
  const label = TRY_PAYOUT.label;
  const amount = TRY_PAYOUT.amountCents;
  const fallback = async (reason: Exclude<TryPayoutResult, { sent: true }>["reason"], plain: string): Promise<TryPayoutResult> => {
    const receipt = await d.latestReceipt().catch(() => null);
    return { sent: false, label, reason, plain: receipt ? `${plain} Here is the most recent sandbox payout from this page.` : plain, receipt };
  };
  const payee = await d.payee();
  if (!payee) return fallback("no_payee", "No sandbox buyer is set up on this server, so no sandbox payout can be sent.");
  if ((await d.paidLast24hCents()) + amount > LIMITS.perDayCents) return fallback("ceiling", "The sample firm has sent its sandbox payouts for today.");
  if (!(await d.allow(`try-payout:visitor:${o.visitorKey}`, TRY_PAYOUT.perVisitorPerDay))) return fallback("visitor", "You have sent today's sandbox payout from this page.");
  if (!(await d.allow("try-payout:day", TRY_PAYOUT.perDay))) return fallback("day", `This page has sent its ${TRY_PAYOUT.perDay} sandbox payouts for today.`);
  const claimId = await d.openClaim({ amountCents: amount });
  const r = await d.pay(claimId, payee);
  if (!r.ok) return { sent: false, label, reason: "not_sent", plain: r.plain, receipt: r.receipt };
  return { sent: true, label, amount: usd(amount), payee: d.mask(payee), plain: r.plain, receipt: r.receipt };
}
