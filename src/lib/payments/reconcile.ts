import { resolveDeps, type PaymentsDeps } from "./deps";
import { recordStatus } from "./events";
import { syncPayoutBatch } from "./payouts";
import { getRefund } from "./refunds";
import { OPEN_STATUSES, captureStatus } from "./status";

/**
 * Bring every open payment up to date by asking PayPal, for when webhooks cannot reach this server (a laptop, a
 * preview deploy). Webhooks and this pass go through the same `recordStatus`, so running both never double-counts.
 */
export async function reconcileOpenPayments(partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const open = await deps.store.findPayments({ statuses: OPEN_STATUSES });
  const report = { open: open.length, batches: 0, refunds: 0, orders: 0, changed: 0, waitingForRetry: 0, errors: [] as string[] };

  const batches = [...new Set(open.filter((p) => p.route === "payout" && p.payoutBatchId).map((p) => p.payoutBatchId!))];
  for (const b of batches) {
    const s = await syncPayoutBatch(b, "poll", deps);
    report.batches++;
    if (s.ok) report.changed += s.changed;
    else report.errors.push(`batch ${b}: ${s.status} ${s.issue}`);
  }

  for (const p of open.filter((x) => x.route === "refund")) {
    if (!p.refundId) {
      report.waitingForRetry++;
      continue;
    }
    const r = await getRefund(p.refundId, deps);
    report.refunds++;
    if (!r.ok) {
      report.errors.push(`refund ${p.refundId}: ${r.status} ${r.issue}`);
      continue;
    }
    if ((await recordStatus(p, r.status, { paypalStatus: r.paypalStatus }, "poll", deps)).changed) report.changed++;
  }

  for (const p of open.filter((x) => x.route === "replacement")) {
    if (!p.orderId) {
      report.waitingForRetry++;
      continue;
    }
    const o = await deps.paypal.getOrder<{ status?: string; purchase_units?: { payments?: { captures?: { status?: string }[] } }[] }>(p.orderId);
    report.orders++;
    if (o.status >= 400) {
      report.errors.push(`order ${p.orderId}: ${o.status}`);
      continue;
    }
    const cs = o.body.purchase_units?.[0]?.payments?.captures?.[0]?.status ?? (o.body.status === "COMPLETED" ? "COMPLETED" : "PENDING");
    if ((await recordStatus(p, captureStatus(cs), { paypalStatus: cs }, "poll", deps)).changed) report.changed++;
  }

  report.waitingForRetry += open.filter((p) => p.route === "payout" && !p.payoutBatchId).length;
  return report;
}

/**
 * Refresh one claim's payment from PayPal, for a page that is waiting on it (the owner's receipt, the claims drawer).
 * In the sandbox a payout item reaches SUCCESS in about 17 seconds, while PayPal's webhook for it can take over a
 * minute, so the page polls this every few seconds and the webhook stays the durable path. Cheap when nothing is open.
 */
export async function refreshPayment(claimId: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const p = await deps.store.getPaymentByClaim(claimId);
  if (!p || !OPEN_STATUSES.includes(p.status)) return p;
  if (p.route === "payout" && p.payoutBatchId) await syncPayoutBatch(p.payoutBatchId, "poll", deps);
  else if (p.route === "refund" && p.refundId) {
    const r = await getRefund(p.refundId, deps);
    if (r.ok) await recordStatus(p, r.status, { paypalStatus: r.paypalStatus }, "poll", deps);
  }
  return deps.store.getPaymentByClaim(claimId);
}
