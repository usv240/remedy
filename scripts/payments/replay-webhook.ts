// Forward real PayPal webhook events to a local Remedy, which checks each one against PayPal's own record.
// This app's registered webhook points at another URL, so PayPal cannot deliver to localhost; PayPal still keeps
// every event it sent for this app, and the webhook route trusts an event it can look up by id.
//   npx tsx --env-file=.env.local scripts/payments/replay-webhook.ts                         last 10 payout events
//   npx tsx --env-file=.env.local scripts/payments/replay-webhook.ts --type PAYMENT.PAYOUTS-ITEM.UNCLAIMED --limit 3
//   npx tsx --env-file=.env.local scripts/payments/replay-webhook.ts --id WH-...            one event
//   BASE_URL=http://localhost:3300 (default)
import { paypalRest } from "../../src/lib/paypal/client";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const BASE = process.env.BASE_URL ?? "http://localhost:3300";
type Ev = { id: string; event_type: string; create_time?: string; resource?: Record<string, unknown> };

async function main() {
  const id = arg("--id");
  const type = arg("--type");
  const limit = Math.min(50, Number(arg("--limit") ?? 10));
  let events: Ev[];
  if (id) {
    const r = await paypalRest<Ev>(`/v1/notifications/webhooks-events/${encodeURIComponent(id)}`, { method: "GET" });
    if (r.status !== 200) throw new Error(`PayPal has no event ${id} (${r.status})`);
    events = [r.body];
  } else {
    const q = new URLSearchParams({ page_size: "50", ...(type ? { event_type: type } : {}) });
    const r = await paypalRest<{ events?: Ev[] }>(`/v1/notifications/webhooks-events?${q}`, { method: "GET" });
    events = (r.body.events ?? []).filter((e) => (type ? e.event_type === type : /^PAYMENT\.PAYOUTS|^PAYMENT\.CAPTURE\.REFUNDED|^CHECKOUT\.ORDER\.APPROVED/.test(e.event_type))).slice(0, limit);
  }
  // Oldest first, the order PayPal sent them.
  for (const e of events.reverse()) {
    const res = await fetch(`${BASE}/api/webhooks/paypal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.log(`${e.create_time ?? ""} ${e.event_type} ${e.id} -> ${res.status} ${j.verification ?? ""} ${j.result ?? j.reason ?? ""}${j.duplicate ? " (already handled)" : ""}`);
  }
  if (!events.length) console.log("No matching events at PayPal.");
}

main().catch((e) => {
  console.error("replay failed:", (e as Error).message);
  process.exit(1);
});
