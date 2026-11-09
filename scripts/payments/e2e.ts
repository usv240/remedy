// End to end in the sandbox, through Remedy's own routes and database (dev server at BASE_URL, default :3300):
//   1. buy the sample power bank: POST /api/shop/orders, approve as the sandbox buyer in Chrome, POST .../capture (twice);
//   2. a sample claim linked to that sale is refunded to the capture by the router (and a second pay pays nothing);
//   3. a $1.00 payout to an email with no PayPal account goes UNCLAIMED; PayPal's real webhook event for it is
//      forwarded to POST /api/webhooks/paypal, verified by lookup, and adds a Re-notice task to plan_task;
//   4. the ledger chain still verifies.
// It makes two sample claims (is_sample = true, origin 'test', so the firm console never lists or counts them) and
// removes them, their payments, tasks and sale afterwards unless --keep is given.
//   npx tsx --env-file=.env.local scripts/payments/e2e.ts [--keep]
import { sql } from "drizzle-orm";
import { verifyLedger } from "../../src/lib/audit";
import { db } from "../../src/lib/db";
import { TEST_ORIGIN } from "../../src/lib/firm/origin";
import { resolveDeps } from "../../src/lib/payments/deps";
import { payClaim, planPayment } from "../../src/lib/payments/router";
import { paypalRest } from "../../src/lib/paypal/client";
import { approveAsBuyer } from "./approve-as-buyer";

const BASE = process.env.BASE_URL ?? "http://localhost:3300";
const keep = process.argv.includes("--keep");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  | ${detail}` : ""}`);
};
async function post(path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON from our own routes, checked field by field below
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, any> | null };
}
type Ev = { id: string; event_type: string; resource?: Record<string, string | undefined> };
async function findEvent(type: string, match: (e: Ev) => boolean, seconds = 90) {
  for (let i = 0; i < seconds / 5; i++) {
    const r = await paypalRest<{ events?: Ev[] }>(`/v1/notifications/webhooks-events?page_size=25&event_type=${type}`, { method: "GET" });
    const e = (r.body.events ?? []).find(match);
    if (e) return e;
    await sleep(5000);
  }
  return null;
}

async function main() {
  const deps = await resolveDeps();
  const made: { claims: string[]; sales: string[]; batches: string[]; events: string[] } = { claims: [], sales: [], batches: [], events: [] };
  try {
    // 1. The shop.
    const created = await post("/api/shop/orders", { return_path: "/shop/return" });
    check("shop order created", created.status === 200 && Boolean(created.json?.data?.approve_url), created.json?.data?.id);
    const orderId: string = created.json!.data.id;
    const back = await approveAsBuyer(created.json!.data.approve_url, `${BASE}/shop/return`);
    check("buyer approved in PayPal and came back", back.token === orderId);
    const cap = await post(`/api/shop/orders/${orderId}/capture`);
    const cap2 = await post(`/api/shop/orders/${orderId}/capture`);
    const captureId: string = cap.json?.data?.capture_id;
    check("capture recorded a sale", cap.status === 200 && Boolean(captureId), `capture ${captureId}, sale ${cap.json?.data?.sale_id}`);
    check("second capture is idempotent", cap2.json?.data?.already === true && cap2.json?.data?.capture_id === captureId);
    made.sales.push(String(cap.json?.data?.sale_id));

    // 2. A claim linked to that sale, refunded to the capture.
    const firm = Number(deps.firm.id);
    const recall = String((await db().execute(sql`select number from recall where title ilike '%power bank%' order by date desc limit 1`)).rows[0]?.number ?? (await db().execute(sql`select number from recall order by date desc limit 1`)).rows[0].number);
    const ins = await db().execute(
      sql`insert into claim (recall_number, firm_id, payee_type, payee_masked, linked_sale_id, decision, status, amount, channel, is_sample, origin) values (${recall}, ${firm}, 'email', 'e2e', ${Number(cap.json?.data?.sale_id)}, 'verified', 'verified', 34.99, 'api', true, ${TEST_ORIGIN}), (${recall}, ${firm}, 'email', 'e2e', null, 'verified', 'verified', 1.00, 'api', true, ${TEST_ORIGIN}) returning id`,
    );
    const [refundClaim, payoutClaim] = ins.rows.map((r) => String(r.id));
    made.claims.push(refundClaim, payoutClaim);
    const plan = await planPayment({ claimId: refundClaim, recallNumber: recall, recallTitle: "Sample power bank recall", decision: "verified", amountCents: 3499, payee: { type: "email", value: process.env.SANDBOX_BUYER_EMAIL! }, choice: "money", linkedCaptureId: captureId }, {}, deps);
    check("router picks a refund to the original capture", plan.ok && plan.plan.route === "refund", plan.ok ? plan.plan.reasons.plain : plan.plain);
    const paid = await payClaim(refundClaim, deps);
    check("refund sent", paid.kind === "sent" && paid.payment.status === "paid", paid.kind === "sent" ? `refund ${paid.payment.refundId}` : paid.kind);
    const again = await payClaim(refundClaim, deps);
    check("second pay pays nothing", again.kind === "already");

    // 3. An unclaimed payout and its webhook.
    await planPayment({ claimId: payoutClaim, recallNumber: recall, recallTitle: "Sample power bank recall", decision: "verified", amountCents: 100, payee: { type: "email", value: `remedy-e2e-${Date.now().toString(36)}@example.com` }, choice: "money" }, {}, deps);
    const out = await payClaim(payoutClaim, deps);
    check("payout sent", out.kind === "sent", out.kind === "sent" ? `batch ${out.payment.payoutBatchId}` : out.kind);
    const batchId = out.kind === "sent" ? out.payment.payoutBatchId! : "";
    made.batches.push(batchId);
    const ev = await findEvent("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", (e) => e.resource?.payout_batch_id === batchId);
    check("PayPal sent PAYMENT.PAYOUTS-ITEM.UNCLAIMED", Boolean(ev), ev?.id);
    if (ev) {
      made.events.push(ev.id);
      const wh = await post("/api/webhooks/paypal", ev);
      check("webhook route trusts it by lookup", wh.status === 200 && wh.json?.verification === "lookup" && wh.json?.result === "item:unclaimed", JSON.stringify(wh.json));
      const dup = await post("/api/webhooks/paypal", ev);
      check("the same event again is a duplicate", dup.json?.duplicate === true);
      const t = await db().execute(sql`select t.kind, t.name, d.ref as after from plan_task t left join plan_task d on d.id = (t.dependencies->0->>'from')::int where t.data->>'claimId' = ${payoutClaim}`);
      check("one Re-notice task, after its payout batch", t.rows.length === 1 && t.rows[0].kind === "re_notice" && t.rows[0].after === `payout-batch:${batchId}`, String(t.rows[0]?.name ?? ""));
    }
    const refundEv = paid.kind === "sent" ? await findEvent("PAYMENT.CAPTURE.REFUNDED", (e) => e.resource?.id === paid.payment.refundId, 60) : null;
    if (refundEv) {
      made.events.push(refundEv.id);
      const wh = await post("/api/webhooks/paypal", refundEv);
      check("PAYMENT.CAPTURE.REFUNDED matches the refund", wh.json?.result?.startsWith("refund:paid") === true, wh.json?.result);
    }
    const approvedEv = await findEvent("CHECKOUT.ORDER.APPROVED", (e) => e.resource?.id === orderId, 30);
    if (approvedEv) {
      made.events.push(approvedEv.id);
      const wh = await post("/api/webhooks/paypal", approvedEv);
      check("CHECKOUT.ORDER.APPROVED for a captured shop order changes nothing", wh.json?.result === "shop:already", wh.json?.result);
    }

    // 4. The ledger.
    const ledger = await verifyLedger();
    check("ledger chain verifies", ledger.ok, `${ledger.count} events`);
  } finally {
    if (!keep) {
      for (const b of made.batches) await db().execute(sql`delete from plan_task where ref in (${`payout-batch:${b}`}, ${`unclaimed-follow-up:${b}`})`);
      for (const c of made.claims) await db().execute(sql`delete from plan_task where data->>'claimId' = ${c}`);
      for (const c of made.claims) await db().execute(sql`delete from claim where id = ${c}`);
      for (const s of made.sales) if (/^\d+$/.test(s)) await db().execute(sql`delete from sale where id = ${Number(s)}`);
      for (const e of made.events) await db().execute(sql`delete from webhook_event where event_id = ${e}`);
      console.log("cleaned up the sample claims, payments, tasks, sale and webhook rows (ledger entries stay, as a ledger should)");
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("e2e failed:", (e as Error).message);
  process.exit(1);
});
