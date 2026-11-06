import type { PaymentsDeps } from "./deps";
import { describeStatus } from "./status";
import type { PaymentRecord, PaymentStatus, PlanTaskRecord } from "./types";

/**
 * In-process payment events. The firm console's live views (the Gantt over SSE, the claims grid) subscribe with
 * `onPaymentEvent`; the webhook route, the poller and the pay call all report through `recordStatus`, so each change
 * is stored, written to the ledger, emitted once, and, for an unclaimed or returned payout, turned into a
 * "Re-notice" row in plan_task that survives a restart.
 */
export type PaymentEventKind = "status_changed" | "paid" | "unclaimed" | "returned" | "failed";
export type PaymentEventSource = "pay" | "webhook" | "poll" | "cancel" | "seed";

export type PaymentEvent = {
  kind: PaymentEventKind;
  payment: PaymentRecord;
  previous: PaymentStatus | null;
  plain: string;
  source: PaymentEventSource;
  at: string;
  /** The re-notice task added for this event, if one was added. */
  task: PlanTaskRecord | null;
};

type Handler = (e: PaymentEvent) => void | Promise<void>;

declare global {
  var __remedyPaymentHandlers: Set<Handler> | undefined;
}

// One registry per server process. Route bundles can load this module more than once in development, so it lives on
// globalThis: a handler added by the SSE route hears events raised by the webhook route.
const handlers = () => (globalThis.__remedyPaymentHandlers ??= new Set<Handler>());

/** Subscribe to payment events. Returns a function that unsubscribes. */
export function onPaymentEvent(handler: Handler): () => void {
  handlers().add(handler);
  return () => handlers().delete(handler);
}

export async function emitPaymentEvent(e: PaymentEvent) {
  for (const h of [...handlers()]) {
    try {
      await h(e);
    } catch {
      // A listener's failure never blocks the payment flow.
    }
  }
}

const kindFor = (s: PaymentStatus): PaymentEventKind => (s === "paid" ? "paid" : s === "unclaimed" ? "unclaimed" : s === "returned" ? "returned" : s === "failed" ? "failed" : "status_changed");

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The Gantt task a follow-up status adds: a short re-notice, after the payout batch it came from. */
export function reNoticeTask(p: PaymentRecord, status: "unclaimed" | "returned", recallNumber: string | null, now: Date, source: PaymentEventSource): PlanTaskRecord {
  return {
    key: `re-notice:${p.requestId}:${status}`,
    firmId: p.firmId,
    recallNumber,
    kind: "re_notice",
    source: source === "webhook" ? "webhook" : source === "cancel" ? "person" : "system",
    name: status === "unclaimed" ? "Re-notice: payout waiting to be accepted" : "Re-notice: payout returned to the firm",
    startDate: day(now),
    durationDays: 2,
    dependsOn: p.payoutBatchId ? `payout-batch:${p.payoutBatchId}` : null,
    data: { claimId: p.claimId, paymentId: p.id, payoutBatchId: p.payoutBatchId, payoutItemId: p.payoutItemId, status, amountCents: p.amountCents },
  };
}

/**
 * Store a payment's new status and tell everyone, once. A repeated status (a webhook retry, a poll after the webhook)
 * changes nothing and emits nothing. Ids PayPal sends along (item id, transaction id) are saved either way.
 */
export async function recordStatus(
  payment: PaymentRecord,
  next: PaymentStatus,
  update: { paypalStatus?: string | null; issue?: string | null; payoutItemId?: string | null; transactionId?: string | null; refundId?: string | null },
  source: PaymentEventSource,
  deps: PaymentsDeps,
): Promise<{ payment: PaymentRecord; changed: boolean; event: PaymentEvent | null }> {
  const patch: Partial<PaymentRecord> = {};
  if (update.paypalStatus !== undefined && update.paypalStatus !== payment.paypalStatus) patch.paypalStatus = update.paypalStatus;
  if (update.issue !== undefined && update.issue !== payment.issue) patch.issue = update.issue;
  if (update.payoutItemId && update.payoutItemId !== payment.payoutItemId) patch.payoutItemId = update.payoutItemId;
  if (update.transactionId && update.transactionId !== payment.transactionId) patch.transactionId = update.transactionId;
  if (update.refundId && update.refundId !== payment.refundId) patch.refundId = update.refundId;
  const changed = next !== payment.status;
  if (changed) patch.status = next;
  if (Object.keys(patch).length === 0) return { payment, changed: false, event: null };

  const saved = (await deps.store.updatePayment(payment.id, patch)) ?? { ...payment, ...patch };
  if (!changed) return { payment: saved, changed: false, event: null };

  // The plan follows its current attempt's payment: landed means paid; money back with the firm means failed, which
  // lets a reviewer start a new attempt. Sending, unclaimed and on hold stay submitted.
  const plan = await deps.store.getPlan(saved.planId);
  const planTo = next === "paid" ? "paid" : (["returned", "failed", "blocked", "canceled", "reversed"] as PaymentStatus[]).includes(next) ? "failed" : null;
  if (plan && planTo && saved.attempt === plan.attempt) await deps.store.transitionPlan(plan.id, ["executing", "submitted", "paid"], planTo);

  const info = describeStatus(next, saved.route);
  await deps.ledger(source === "webhook" ? "webhook" : "system", `payment.${next}`, `claim:${saved.claimId}`, {
    payment: saved.id,
    route: saved.route,
    from: payment.status,
    to: next,
    paypal_status: saved.paypalStatus,
    issue: saved.issue,
    source,
  });

  let task: PlanTaskRecord | null = null;
  if (next === "unclaimed" || next === "returned") {
    const t = reNoticeTask(saved, next, plan?.recallNumber ?? null, deps.now(), source);
    if ((await deps.store.addPlanTask(t)).created) {
      task = t;
      await deps.ledger("system", "plan.task_added", `claim:${saved.claimId}`, { task: t.key, kind: t.kind, depends_on: t.dependsOn });
    }
  }

  const event: PaymentEvent = { kind: kindFor(next), payment: saved, previous: payment.status, plain: info.plain, source, at: deps.now().toISOString(), task };
  await emitPaymentEvent(event);
  return { payment: saved, changed: true, event };
}
