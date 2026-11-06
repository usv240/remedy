import { dbConfigured } from "@/lib/db";
import { paypalConfigured } from "@/lib/paypal/client";
import { processWebhook } from "@/lib/payments/webhooks";

/**
 * POST /api/webhooks/paypal: PayPal tells Remedy when a payout lands, waits to be accepted, comes back, or a refund
 * or shop checkout completes. Nothing changes until the event is trusted: PayPal's signature check
 * (PAYPAL_WEBHOOK_ID), or PayPal's own record of the event, fetched with this app's credentials. Untrusted events are
 * stored and ignored. Each event id is handled once; PayPal's retries get the first result.
 */
export async function POST(req: Request) {
  if (!paypalConfigured() || !dbConfigured()) {
    return Response.json({ received: false, reason: "Webhooks are not configured on this server." }, { status: 503 });
  }
  const raw = await req.text();
  if (raw.length > 256_000) return Response.json({ received: false, reason: "Event too large." }, { status: 413 });
  const r = await processWebhook(raw, req.headers);
  return Response.json(r.body, { status: r.status });
}
