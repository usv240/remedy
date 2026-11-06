import { audit } from "@/lib/audit";
import { dbConfigured } from "@/lib/db";
import { log, withRequest } from "@/lib/log";
import { paypalConfigured } from "@/lib/paypal/client";
import { processWebhook } from "@/lib/payments/webhooks";

/**
 * POST /api/webhooks/paypal: PayPal tells Remedy when a payout lands, waits to be accepted, comes back, or a refund
 * or shop checkout completes. Nothing changes until the event is trusted: PayPal's signature check
 * (PAYPAL_WEBHOOK_ID), or PayPal's own record of the event, fetched with this app's credentials. Untrusted events are
 * stored and ignored. Each event id is handled once; PayPal's retries get the first result. Stays synchronous: PayPal
 * expects the answer in the same call, and the work is one row update.
 */
export async function POST(req: Request) {
  return withRequest(req, "POST /api/webhooks/paypal", async () => {
    if (!paypalConfigured() || !dbConfigured()) {
      return Response.json({ received: false, reason: "Webhooks are not configured on this server." }, { status: 503 });
    }
    const raw = await req.text();
    if (raw.length > 256_000) return Response.json({ received: false, reason: "Event too large." }, { status: 413 });
    const r = await processWebhook(raw, req.headers);
    const b = r.body as { received?: boolean; trusted?: boolean; duplicate?: boolean; verification?: string; result?: string; reason?: string };
    const eventId = (() => {
      try {
        return String((JSON.parse(raw) as { id?: string }).id ?? "");
      } catch {
        return "";
      }
    })();
    log.info("webhook", { event_id: eventId, status: r.status, trusted: b.trusted ?? null, duplicate: Boolean(b.duplicate), verification: b.verification ?? null, result: b.result ?? b.reason ?? null });
    if (b.duplicate && eventId) await audit("webhook", "paypal.webhook.duplicate", `webhook:${eventId}`, { event: eventId }).catch(() => null);
    return Response.json(r.body, { status: r.status });
  });
}
