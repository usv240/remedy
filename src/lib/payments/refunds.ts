import { SANDBOX_LABEL, resolveDeps, toCents, toValue, type PaymentsDeps } from "./deps";
import { issueOf } from "./payouts";
import { plainIssue, refundStatus } from "./status";

/**
 * Refunds back to the original PayPal payment. PayPal accepts a refund on a capture for 180 days, so the router
 * checks the window first and pays a payout instead after that. `hasPriorRefund` is check C6 ("not already
 * refunded"): it reads the capture, the refunds on its order, Remedy's own refunds, and the Disputes API.
 */

export const REFUND_WINDOW_DAYS = 180;
const DAY = 86_400_000;

/** Whether a capture can still be refunded at `now`. Day 180 itself is inside the window. */
export function refundWindow(capturedAt: Date | string, now: Date) {
  const at = new Date(capturedAt);
  const ageMs = now.getTime() - at.getTime();
  const deadline = new Date(at.getTime() + REFUND_WINDOW_DAYS * DAY);
  return {
    within: ageMs >= 0 && ageMs <= REFUND_WINDOW_DAYS * DAY,
    ageDays: Math.floor(ageMs / DAY),
    daysLeft: Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / DAY)),
    deadline: deadline.toISOString(),
  };
}

type Link = { rel?: string; href?: string };
type CaptureBody = {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string };
  create_time?: string;
  custom_id?: string;
  links?: Link[];
  supplementary_data?: { related_ids?: { order_id?: string } };
  name?: string;
  details?: { issue?: string }[];
};
type OrderBody = { purchase_units?: { payments?: { refunds?: { id?: string; status?: string; amount?: { value?: string }; links?: Link[] }[] } }[] };

export type CaptureView = { captureId: string; status: string; amountCents: number; capturedAt: string | null; orderId: string | null; customId: string | null };

export async function getCapture(captureId: string, partial?: Partial<PaymentsDeps>): Promise<{ ok: true; capture: CaptureView } | { ok: false; status: number; issue: string }> {
  const deps = await resolveDeps(partial);
  const r = await deps.rest<CaptureBody>(`/v2/payments/captures/${encodeURIComponent(captureId)}`, { method: "GET" });
  if (r.status >= 400) return { ok: false, status: r.status, issue: issueOf(r.body) };
  const up = r.body.links?.find((l) => l.rel === "up")?.href;
  return {
    ok: true,
    capture: {
      captureId,
      status: r.body.status ?? "UNKNOWN",
      amountCents: toCents(r.body.amount?.value ?? 0),
      capturedAt: r.body.create_time ?? null,
      orderId: r.body.supplementary_data?.related_ids?.order_id ?? (up?.includes("/checkout/orders/") ? up.split("/").pop()! : null),
      customId: r.body.custom_id ?? null,
    },
  };
}

export type RefundResult =
  | { ok: true; refundId: string; paypalStatus: string; status: ReturnType<typeof refundStatus>; debugId: string | null }
  | { ok: false; issue: string; plain: string; status: number; debugId: string | null; definite: boolean };

/**
 * POST /v2/payments/captures/{id}/refund for `amountCents`, with PayPal-Request-Id so a retry of the same attempt
 * returns the first refund instead of making a second one.
 */
export async function refundCapture(
  o: { captureId: string; amountCents: number; requestId: string; noteToPayer?: string; mock?: string },
  partial?: Partial<PaymentsDeps>,
): Promise<RefundResult> {
  const deps = await resolveDeps(partial);
  type RefundBody = { id?: string; status?: string; name?: string; details?: { issue?: string }[]; debug_id?: string };
  const call = () =>
    deps.rest<RefundBody>(`/v2/payments/captures/${encodeURIComponent(o.captureId)}/refund`, {
      method: "POST",
      requestId: o.requestId,
      headers: { Prefer: "return=representation", ...(o.mock ? { "PayPal-Mock-Response": JSON.stringify({ mock_application_codes: o.mock }) } : {}) },
      body: JSON.stringify({
        amount: { value: toValue(o.amountCents), currency_code: "USD" },
        note_to_payer: (o.noteToPayer ?? `Recall refund. ${SANDBOX_LABEL}`).slice(0, 255),
      }),
    });
  const offline = { status: 599, body: { name: "NETWORK_ERROR" } as RefundBody, debugId: null };
  let r = await call().catch(() => offline);
  for (let i = 1; r.status >= 500 && i <= 2; i++) {
    await new Promise((res) => setTimeout(res, 700 * i));
    r = await call().catch(() => offline);
  }
  if (r.status < 400 && r.body.id) return { ok: true, refundId: r.body.id, paypalStatus: r.body.status ?? "PENDING", status: refundStatus(r.body.status), debugId: r.debugId };
  // A refund refusal names the reason in details (for example CAPTURE_FULLY_REFUNDED); prefer it over the generic name.
  const issue = r.body.details?.[0]?.issue ?? r.body.name ?? "PAYPAL_ERROR";
  return { ok: false, issue, plain: plainIssue(issue), status: r.status, debugId: r.debugId ?? r.body.debug_id ?? null, definite: r.status >= 400 && r.status < 500 };
}

export async function getRefund(refundId: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const r = await deps.rest<{ id?: string; status?: string; amount?: { value?: string }; name?: string }>(`/v2/payments/refunds/${encodeURIComponent(refundId)}`, { method: "GET" });
  if (r.status >= 400) return { ok: false as const, status: r.status, issue: r.body.name ?? "PAYPAL_ERROR" };
  return { ok: true as const, paypalStatus: r.body.status ?? "PENDING", status: refundStatus(r.body.status), amountCents: toCents(r.body.amount?.value ?? 0) };
}

export type PriorRefund = {
  captureId: string;
  found: boolean;
  /** Any refund already made on this purchase (full or partial), at PayPal or by Remedy. */
  refunded: boolean;
  fullyRefunded: boolean;
  refundedCents: number;
  captureCents: number;
  /** What can still be refunded to this capture. */
  remainingCents: number;
  captureStatus: string | null;
  capturedAt: string | null;
  orderId: string | null;
  disputes: { checked: boolean; count: number; open: number; ids: string[]; note: string | null };
  /** C6 passes: the purchase is found, has no earlier refund and no dispute. */
  pass: boolean;
  plain: string;
  technical: string;
  /** The PayPal calls made, for Technical view. */
  calls: string[];
};

const OPEN_DISPUTE = new Set(["OPEN", "WAITING_FOR_BUYER_RESPONSE", "WAITING_FOR_SELLER_RESPONSE", "UNDER_REVIEW"]);

/**
 * Has this capture been refunded or disputed already? Reads PayPal's capture (status and amount), the refunds on its
 * order, Remedy's own refund payments (which cover the moment before PayPal's copy updates), and
 * GET /v1/customer/disputes?disputed_transaction_id=. The sandbox app holds the disputes read-seller scope; if a
 * deployment does not, the dispute part is skipped and named in `disputes.note`, and the result still stands on
 * the refund evidence.
 */
export async function hasPriorRefund(captureId: string, partial?: Partial<PaymentsDeps>): Promise<PriorRefund> {
  const deps = await resolveDeps(partial);
  const calls: string[] = [`GET /v2/payments/captures/${captureId}`];
  const base = { captureId, refundedCents: 0, captureCents: 0, remainingCents: 0, captureStatus: null, capturedAt: null, orderId: null, calls };
  const noDisputes = { checked: false, count: 0, open: 0, ids: [], note: null };

  const cap = await getCapture(captureId, deps);
  if (!cap.ok) {
    const missing = cap.status === 404;
    return {
      ...base,
      found: false,
      refunded: false,
      fullyRefunded: false,
      disputes: noDisputes,
      pass: false,
      plain: missing ? "We could not find that PayPal purchase, so a person at the firm will check it." : "PayPal did not answer the refund check, so a person at the firm will check it.",
      technical: `GET capture returned ${cap.status} ${cap.issue}`,
    };
  }
  const c = cap.capture;

  // Refunds on this capture, from its order (PayPal lists them under purchase_units[].payments.refunds).
  let paypalRefunded = 0;
  if (c.orderId) {
    calls.push(`GET /v2/checkout/orders/${c.orderId}`);
    const o = await deps.rest<OrderBody>(`/v2/checkout/orders/${encodeURIComponent(c.orderId)}`, { method: "GET" });
    if (o.status < 400) {
      for (const pu of o.body.purchase_units ?? [])
        for (const rf of pu.payments?.refunds ?? []) {
          const upCapture = rf.links?.find((l) => l.rel === "up")?.href?.split("/").pop();
          const counts = rf.status === "COMPLETED" || rf.status === "PENDING";
          if (counts && (!upCapture || upCapture === captureId)) paypalRefunded += toCents(rf.amount?.value ?? 0);
        }
    }
  }
  // Remedy's own refunds to this capture that are not failed or canceled.
  const ours = (await deps.store.findPayments({ captureId })).filter((p) => p.route === "refund" && p.status !== "failed" && p.status !== "canceled");
  const oursCents = ours.reduce((s, p) => s + p.amountCents, 0);
  const statusSays = c.status === "REFUNDED" ? c.amountCents : 0;
  const refundedCents = Math.max(paypalRefunded, oursCents, statusSays);
  const refunded = refundedCents > 0 || c.status === "PARTIALLY_REFUNDED" || c.status === "REFUNDED";
  const fullyRefunded = c.status === "REFUNDED" || refundedCents >= c.amountCents;

  calls.push(`GET /v1/customer/disputes?disputed_transaction_id=${captureId}`);
  const d = await deps.rest<{ items?: { dispute_id?: string; status?: string }[]; name?: string }>(`/v1/customer/disputes?disputed_transaction_id=${encodeURIComponent(captureId)}&page_size=10`, { method: "GET" });
  const disputes =
    d.status < 400
      ? { checked: true, count: d.body.items?.length ?? 0, open: (d.body.items ?? []).filter((x) => OPEN_DISPUTE.has(x.status ?? "")).length, ids: (d.body.items ?? []).map((x) => x.dispute_id ?? "").filter(Boolean), note: null }
      : { checked: false, count: 0, open: 0, ids: [], note: d.status === 401 || d.status === 403 ? "This PayPal app does not have the disputes read scope, so disputes were not checked." : `The Disputes API answered ${d.status}, so disputes were not checked.` };

  const pass = !refunded && disputes.count === 0 && c.status === "COMPLETED";
  const plain = refunded
    ? fullyRefunded
      ? "This purchase was already refunded in full."
      : "Part of this purchase was already refunded, so a person at the firm will check the rest."
    : disputes.count > 0
      ? "This purchase has a PayPal dispute, so a person at the firm will check it first."
      : c.status !== "COMPLETED"
        ? "This PayPal purchase is not complete yet, so a person at the firm will check it."
        : disputes.checked
          ? "No earlier refund or dispute."
          : "No earlier refund.";
  return {
    ...base,
    found: true,
    refunded,
    fullyRefunded,
    refundedCents,
    captureCents: c.amountCents,
    remainingCents: Math.max(0, c.amountCents - refundedCents),
    captureStatus: c.status,
    capturedAt: c.capturedAt,
    orderId: c.orderId,
    disputes,
    pass,
    plain,
    technical: `capture ${c.status}, ${toValue(c.amountCents)} USD; refunded at PayPal ${toValue(paypalRefunded)}, by Remedy ${toValue(oursCents)}; disputes ${disputes.checked ? disputes.count : "not checked"}`,
  };
}

/**
 * The verification engine's C6 hook (`ClaimContext.hasPriorRefund` in src/lib/verify/types.ts), in its exact shape.
 * A capture PayPal cannot find, or one that is not complete, throws, which that engine turns into "unclear" (a person
 * at the firm looks) rather than a pass.
 */
export async function priorRefundCheck(captureId: string, partial?: Partial<PaymentsDeps>) {
  const r = await hasPriorRefund(captureId, partial);
  const disputed = r.disputes.count > 0;
  if (!r.pass && !r.refunded && !disputed) throw new Error(r.technical || r.plain);
  return { refunded: r.refunded, disputed, plain: r.plain, technical: r.technical };
}

/** Check C6 in the verification builder's shape. No linked purchase passes, as the plan says. */
export async function c6Check(captureId: string | null | undefined, partial?: Partial<PaymentsDeps>) {
  if (!captureId) return { pass: true, reason_plain: "No PayPal purchase linked.", reason_technical: "No capture id on this claim.", evidence: null };
  const r = await hasPriorRefund(captureId, partial);
  return { pass: r.pass, reason_plain: r.plain, reason_technical: r.technical, evidence: { calls: r.calls, capture_status: r.captureStatus, refunded_cents: r.refundedCents, disputes: r.disputes } };
}
