// Record what the PayPal sandbox accepts for Payouts, with $1.00 items: EMAIL, PHONE, Venmo, an unregistered email
// (UNCLAIMED), negative testing with PayPal-Mock-Response, and canceling an unclaimed item.
//   npx tsx --env-file=.env.local scripts/payments/sandbox-probe.ts
// Uses an in-memory store, so it touches no database and no ledger: it writes no claim or payment row, so nothing it
// sends can show in the firm console. Its batches carry the sender_batch_id prefix rmd-probe-, which no claim uses, so
// a PayPal webhook about one finds no claim and changes nothing.
import { memoryLedger } from "../../src/lib/payments/deps";
import { buildPayoutBatch, cancelPayoutItem, createPayoutBatch, getPayoutBatch, type PayoutLine } from "../../src/lib/payments/payouts";
import { MemoryStore } from "../../src/lib/payments/store";
import type { Rest } from "../../src/lib/payments/types";
import { paypalRest } from "../../src/lib/paypal/client";

const deps = { store: new MemoryStore(), ledger: memoryLedger().ledger, rest: paypalRest as Rest, firm: { id: null, name: "Brightline Home (sample)" } };
const stamp = Date.now().toString(36);
const line = (claimId: string, payee: PayoutLine["payee"]): PayoutLine => ({ claimId, amountCents: 100, payee, recallNumber: "26055", recallTitle: "Sandbox probe" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const buyer = process.env.SANDBOX_BUYER_EMAIL!.trim();
  const out: Record<string, unknown> = {};

  const sent: Record<string, string> = {};
  for (const [tag, payee] of [
    ["email", { type: "email", value: buyer }],
    ["phone", { type: "phone", value: "4085550123" }],
    ["unregistered_email", { type: "email", value: `remedy-unclaimed-${stamp}@example.com` }],
  ] as const) {
    const r = await createPayoutBatch([line(`probe-${tag}`, payee)], { senderBatchId: `rmd-probe-${tag}-${stamp}` }, deps);
    out[tag] = r.ok ? { accepted: true, payout_batch_id: r.payoutBatchId } : { accepted: false, issue: r.issue, status: r.status };
    if (r.ok) sent[tag] = r.payoutBatchId;
  }

  // Venmo exactly as live would send it, then the library's sandbox fallback.
  const venmoBody = buildPayoutBatch([line("probe-venmo", { type: "venmo", value: "4085550124" })], { senderBatchId: `rmd-probe-venmo-${stamp}`, firmName: deps.firm.name, venmoWallet: true });
  const raw = await paypalRest<{ name?: string; details?: { field?: string; issue?: string }[] }>("/v1/payments/payouts", { method: "POST", requestId: `rmd-probe-venmo-${stamp}`, body: JSON.stringify(venmoBody) });
  out.venmo_wallet = { status: raw.status, name: raw.body.name ?? null, detail: raw.body.details?.[0]?.issue ?? null };
  const fb = await createPayoutBatch([line("probe-venmo-fb", { type: "venmo", value: "4085550124" })], { senderBatchId: `rmd-probe-venmofb-${stamp}` }, deps);
  out.venmo_fallback = fb.ok ? { accepted: true, payout_batch_id: fb.payoutBatchId, wallet_fallback: fb.walletFallback, sender_batch_id: fb.senderBatchId } : { accepted: false, issue: fb.issue };
  if (fb.ok) sent.venmo_fallback = fb.payoutBatchId;

  // Negative testing: which mock codes the Payouts API takes on create.
  const mocks: Record<string, string> = {};
  for (const code of ["INSUFFICIENT_FUNDS", "UNCLAIMED", "RETURNED", "RECEIVER_UNREGISTERED"]) {
    const r = await createPayoutBatch([line("probe-mock", { type: "email", value: buyer })], { senderBatchId: `rmd-probe-mock-${code.toLowerCase()}-${stamp}`, mock: code }, deps);
    mocks[code] = r.ok ? `accepted (batch ${r.payoutBatchId})` : `${r.status} ${r.issue}`;
  }
  out.mock_on_create = mocks;

  // Same request id twice: PayPal returns the first batch.
  const again = await createPayoutBatch([line("probe-email", { type: "email", value: buyer })], { senderBatchId: `rmd-probe-email-${stamp}` }, deps);
  out.same_request_id = again.ok ? { same_batch: again.payoutBatchId === sent.email, payout_batch_id: again.payoutBatchId } : { issue: again.issue };

  await sleep(15000);
  const statuses: Record<string, unknown> = {};
  for (const [tag, id] of Object.entries(sent)) {
    const b = await getPayoutBatch(id, deps);
    statuses[tag] = b.ok ? b.batch.items.map((i) => ({ paypal_status: i.paypalStatus, remedy_status: i.status, issue: i.issue, item: i.payoutItemId, recipient_type: i.recipientType })) : b.issue;
  }
  out.item_statuses_after_15s = statuses;

  const unclaimed = (statuses.unregistered_email as { item?: string }[] | undefined)?.[0]?.item;
  if (unclaimed) out.cancel_unclaimed = await cancelPayoutItem(unclaimed, deps);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("probe failed:", (e as Error).message);
  process.exit(1);
});
