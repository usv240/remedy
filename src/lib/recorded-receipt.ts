import transcript from "../../content/public/e2e-transcript.json";

/**
 * One recorded sandbox payout receipt, for anyone who wants to see a receipt without sending a payout. It is read from
 * the one-click payout's last run in content/public/e2e-transcript.json (tests/e2e/try-payout.mjs): PayPal's real
 * batch and item ids, the status PayPal reported and how long it took. It lives in the repo, not the database, so it
 * opens at the same address on every deployment and no reseeding can remove it. Static JSON import, so the page can
 * prerender with no database and no keys.
 */
export const RECORDED_RECEIPT_URL = "/r/recorded";

type Suite = {
  about: string;
  ranAt: string;
  base: string;
  passed: number;
  failed: number;
  ids: { claim_ids?: string[]; amount?: string; route?: string; payout_batch_id?: string; payout_item_id?: string; payout_status?: string; approval_to_paid_s?: number };
  steps: { step: string; ok: boolean; at_ms: number; detail: string }[];
};

export type RecordedReceipt = {
  amount: string;
  route: "payout";
  batchId: string;
  itemId: string;
  status: string;
  seconds: number | null;
  ranAt: string;
  base: string;
  passed: number;
  steps: Suite["steps"];
  source: string;
  suite: string;
};

/** The recorded receipt, or null when the transcript holds no passing one-click payout with PayPal's ids. */
export function recordedReceipt(): RecordedReceipt | null {
  const s = (transcript.suites as Record<string, Suite | undefined>)["try-payout"];
  const ids = s?.ids;
  if (!s || s.failed !== 0 || ids?.route !== "payout" || !ids.payout_batch_id || !ids.payout_item_id || !ids.payout_status || !ids.amount) return null;
  return {
    amount: ids.amount,
    route: "payout",
    batchId: ids.payout_batch_id,
    itemId: ids.payout_item_id,
    status: ids.payout_status,
    seconds: typeof ids.approval_to_paid_s === "number" ? ids.approval_to_paid_s : null,
    ranAt: s.ranAt,
    base: s.base,
    passed: s.passed,
    steps: s.steps,
    source: "content/public/e2e-transcript.json",
    suite: "tests/e2e/try-payout.mjs",
  };
}
