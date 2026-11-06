import { resolveDeps, type PaymentsDeps } from "./deps";
import { recordStatus } from "./events";
import { applyPayoutItem, getPayoutItem, syncPayoutBatch, type PayPalPayoutItem } from "./payouts";
import { captureShopOrder } from "./shop";
import { SHOP } from "./shop-catalog";
import { refundStatus } from "./status";

/**
 * PayPal webhooks. An event changes nothing until it is trusted, in one of two ways:
 * 1. Signature: PayPal's verify-webhook-signature API with PAYPAL_WEBHOOK_ID and the five transmission headers
 *   . This needs a webhook registered to this app's URL.
 * 2. Lookup: GET /v1/notifications/webhooks-events/{id} with this app's credentials. If PayPal has an event with that
 *    id, type and resource, Remedy acts on PayPal's own copy, never on the posted body. This is how events reach a
 *    local server: the app's existing webhook is registered to another URL, so its deliveries carry signatures for
 *    that URL, and `scripts/payments/replay-webhook.ts` forwards PayPal's recorded events here.
 * Anything else is stored as untrusted and ignored. Each event id is handled once (PayPal retries deliveries).
 */

export type PayPalWebhookEvent = { id?: string; event_type?: string; resource_type?: string; create_time?: string; summary?: string; resource?: Record<string, unknown> };

export const SIGNATURE_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

export const HANDLED_EVENTS = [
  "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "CHECKOUT.ORDER.APPROVED",
] as const;

type Res = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** The id that names an event's resource: an item, a batch, a capture, a refund or an order. */
export function resourceIdOf(e: PayPalWebhookEvent): string | null {
  const r = (e.resource ?? {}) as Res;
  return str(r.payout_item_id) ?? str((r.batch_header as Res | undefined)?.payout_batch_id) ?? str(r.id);
}

export type Verification = { trusted: boolean; method: "signature" | "lookup" | "none"; event: PayPalWebhookEvent; reason: string };

export async function verifyEvent(headers: Headers, event: PayPalWebhookEvent, partial?: Partial<PaymentsDeps>): Promise<Verification> {
  const deps = await resolveDeps(partial);
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  const h = Object.fromEntries(SIGNATURE_HEADERS.map((k) => [k, headers.get(k)]));
  if (webhookId && SIGNATURE_HEADERS.every((k) => h[k])) {
    const r = await deps.rest<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: JSON.stringify({
        auth_algo: h["paypal-auth-algo"],
        cert_url: h["paypal-cert-url"],
        transmission_id: h["paypal-transmission-id"],
        transmission_sig: h["paypal-transmission-sig"],
        transmission_time: h["paypal-transmission-time"],
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    if (r.status === 200 && r.body.verification_status === "SUCCESS") return { trusted: true, method: "signature", event, reason: "PayPal verified the signature." };
  }
  if (!event.id || !/^WH-[A-Z0-9-]{10,80}$/.test(event.id)) return { trusted: false, method: "none", event, reason: "No verifiable signature and not a PayPal event id." };
  const got = await deps.rest<PayPalWebhookEvent>(`/v1/notifications/webhooks-events/${encodeURIComponent(event.id)}`, { method: "GET" });
  if (got.status === 200 && got.body.id === event.id && got.body.event_type === event.event_type && resourceIdOf(got.body) === resourceIdOf(event)) {
    return { trusted: true, method: "lookup", event: got.body, reason: "PayPal has this event on record; acting on PayPal's copy." };
  }
  return { trusted: false, method: "none", event, reason: got.status === 404 ? "PayPal has no event with this id." : "The event does not match PayPal's record." };
}

/** Act on a trusted event. Returns a short result word for the ledger and the webhook_event row. */
export async function handleEvent(event: PayPalWebhookEvent, partial?: Partial<PaymentsDeps>): Promise<string> {
  const deps = await resolveDeps(partial);
  const type = event.event_type ?? "";
  const r = (event.resource ?? {}) as Res;

  if (type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const itemId = str(r.payout_item_id);
    // Read the item's current status from PayPal: events can arrive out of order, and PayPal's answer is the truth.
    const fresh = itemId ? await getPayoutItem(itemId, deps) : null;
    const item: PayPalPayoutItem =
      fresh?.ok
        ? {
            payout_item_id: fresh.item.payoutItemId ?? undefined,
            transaction_id: fresh.item.transactionId ?? undefined,
            transaction_status: fresh.item.paypalStatus,
            payout_batch_id: fresh.item.payoutBatchId ?? undefined,
            sender_batch_id: str(r.sender_batch_id) ?? undefined,
            payout_item: { sender_item_id: fresh.item.senderItemId ?? undefined },
            errors: fresh.item.issue ? { name: fresh.item.issue } : undefined,
          }
        : (r as PayPalPayoutItem);
    const out = await applyPayoutItem(item, "webhook", deps);
    return out.matched ? `item:${out.status}${out.changed ? "" : ":unchanged"}` : "item:not_ours";
  }

  if (type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const batchId = str((r.batch_header as Res | undefined)?.payout_batch_id);
    if (!batchId) return "batch:no_id";
    if (!(await deps.store.findPayments({ payoutBatchId: batchId })).length) return "batch:not_ours";
    const s = await syncPayoutBatch(batchId, "webhook", deps);
    return s.ok ? `batch:${s.batchStatus}:${s.changed}_changed` : `batch:sync_failed:${s.status}`;
  }

  if (type === "PAYMENT.CAPTURE.REFUNDED") {
    // The resource is the refund; its "up" link names the capture it refunded.
    const links = (r.links as { rel?: string; href?: string }[] | undefined) ?? [];
    const refundId = str(r.id);
    const captureId = links.find((l) => l.rel === "up")?.href?.split("/").pop() ?? null;
    const [byRefund] = refundId ? await deps.store.findPayments({ refundId }) : [];
    const payment = byRefund ?? (captureId ? (await deps.store.findPayments({ captureId })).find((p) => p.route === "refund" && !p.refundId) : undefined);
    if (!payment) return "refund:not_ours";
    const out = await recordStatus(payment, refundStatus(str(r.status) ?? "COMPLETED"), { paypalStatus: str(r.status), refundId }, "webhook", deps);
    return `refund:${out.payment.status}${out.changed ? "" : ":unchanged"}`;
  }

  if (type === "CHECKOUT.ORDER.APPROVED" || type === "PAYMENT.CAPTURE.COMPLETED") {
    const units = (r.purchase_units as { reference_id?: string; custom_id?: string }[] | undefined) ?? [];
    const orderId = type === "CHECKOUT.ORDER.APPROVED" ? str(r.id) : str((r.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id);
    const shop = type === "CHECKOUT.ORDER.APPROVED" ? units.some((u) => u.reference_id === SHOP.referenceId || u.custom_id?.startsWith(SHOP.customIdPrefix)) : Boolean(str(r.custom_id)?.startsWith(SHOP.customIdPrefix));
    if (!orderId || !shop) return "order:not_shop";
    // The buyer approved (or PayPal completed the payment) but may never return to the page: capture and record now.
    const c = await captureShopOrder(orderId, "webhook", deps);
    return `shop:${c.kind}`;
  }

  return "noted";
}

/** The webhook route's whole job, testable without HTTP: parse, verify, dedupe, act, record. */
export async function processWebhook(raw: string, headers: Headers, partial?: Partial<PaymentsDeps>): Promise<{ status: number; body: Record<string, unknown> }> {
  const deps = await resolveDeps(partial);
  let posted: PayPalWebhookEvent | null = null;
  try {
    posted = JSON.parse(raw) as PayPalWebhookEvent;
  } catch {
    posted = null;
  }
  if (!posted?.id || !posted.event_type) return { status: 400, body: { received: false, reason: "Not a PayPal event." } };

  const known = await deps.store.getWebhookEvent(posted.id);
  if (known?.trusted && known.result) return { status: 200, body: { received: true, duplicate: true, result: known.result } };

  const v = await verifyEvent(headers, posted, deps);
  const event = v.event;
  await deps.store.recordWebhookEvent({
    eventId: posted.id,
    eventType: posted.event_type,
    resourceId: resourceIdOf(event),
    trusted: v.trusted,
    verification: v.method,
    payload: event,
    result: null,
    receivedAt: deps.now().toISOString(),
  });
  if (!v.trusted) {
    await deps.store.finishWebhookEvent(posted.id, "ignored_untrusted");
    return { status: 400, body: { received: false, trusted: false, reason: v.reason } };
  }

  let result: string;
  try {
    result = await handleEvent(event, deps);
  } catch (e) {
    result = `error:${(e as Error).message.slice(0, 80)}`;
  }
  await deps.store.finishWebhookEvent(posted.id, result);
  await deps.ledger("webhook", `paypal.webhook.${posted.event_type.toLowerCase()}`, `webhook:${posted.id}`, { event: posted.id, verification: v.method, resource: resourceIdOf(event), result });
  // A failure inside our own handling asks PayPal to deliver again later.
  return { status: result.startsWith("error:") ? 500 : 200, body: { received: true, trusted: true, verification: v.method, result } };
}
