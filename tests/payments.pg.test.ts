import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryLedger, type PaymentsDeps } from "@/lib/payments/deps";
import { FakePayPal } from "@/lib/payments/fake-paypal";
import { payClaim, planPayment, retryPlan } from "@/lib/payments/router";
import { captureShopOrder } from "@/lib/payments/shop";
import { SHOP } from "@/lib/payments/shop-catalog";
import { processWebhook } from "@/lib/payments/webhooks";

/**
 * The Postgres store against the real `remedy` database (skipped without DATABASE_URL), with PayPal faked so no
 * money moves and the real ledger is untouched (memory ledger). It makes one sample claim on a real recall, pays it,
 * replays a webhook, records a shop sale, and removes every row it made at the end.
 */
const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("payments on Postgres", async () => {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { PgStore } = await import("@/lib/payments/pg-store");
  const store = new PgStore();
  const pp = new FakePayPal();
  const { ledger } = memoryLedger();
  const tag = `pgtest-${Date.now().toString(36)}`;
  let deps: Partial<PaymentsDeps>;
  let claimId = "";
  let claim2 = "";
  let recall = "";

  beforeAll(async () => {
    const firm = await store.sampleFirmId();
    if (!firm) throw new Error("Seed the sample firm first.");
    const r = await db().execute(sql`select number from recall order by number desc limit 1`);
    recall = String(r.rows[0].number);
    const c = await db().execute(sql`insert into claim (recall_number, firm_id, payee_type, payee_masked, decision, status, amount, channel, is_sample) values (${recall}, ${Number(firm)}, 'email', ${tag}, 'verified', 'verified', 34.99, 'api', true), (${recall}, ${Number(firm)}, 'email', ${tag}, 'verified', 'verified', 20.00, 'api', true) returning id`);
    claimId = String(c.rows[0].id);
    claim2 = String(c.rows[1].id);
    deps = { store, ledger, rest: pp.rest, firm: { id: firm, name: "Brightline Home (sample)" } };
  });

  afterAll(async () => {
    if (!claimId) return;
    await db().execute(sql`delete from plan_task where data->>'claimId' in (${claimId}, ${claim2}) or ref like ${"%" + tag + "%"} or data::text like ${"%" + tag + "%"}`);
    const batches = await db().execute(sql`select distinct paypal_batch_id from payment where claim_id in (${claimId}, ${claim2}) and paypal_batch_id is not null`);
    for (const b of batches.rows) await db().execute(sql`delete from plan_task where ref in (${"payout-batch:" + b.paypal_batch_id}, ${"unclaimed-follow-up:" + b.paypal_batch_id})`);
    await db().execute(sql`delete from claim where id in (${claimId}, ${claim2})`);
    await db().execute(sql`delete from webhook_event where event_id like ${"WH-" + tag.toUpperCase().replace(/[^A-Z0-9]/g, "") + "%"}`);
    await db().execute(sql`delete from sale where paypal_order_id like 'ORD%' and item_name = ${SHOP.product.name} and paypal_capture_id like 'CAP%'`);
  });

  it("plans once per claim, pays once, and maps statuses to the shell's words", async () => {
    const plan = await planPayment(
      { claimId, recallNumber: recall, recallTitle: "Test recall", decision: "verified", amountCents: 3499, payee: { type: "email", value: "unregistered-owner@example.com" }, choice: "money" },
      {},
      deps,
    );
    expect(plan.ok && plan.plan.status).toBe("approved");
    expect(plan.ok && /^\d+$/.test(plan.plan.id)).toBe(true);
    const again = await planPayment({ claimId, recallNumber: recall, recallTitle: "x", decision: "verified", amountCents: 100, payee: null, choice: "money" }, {}, deps);
    expect(again.ok && again.created).toBe(false);

    const [a, b] = await Promise.all([payClaim(claimId, deps), payClaim(claimId, deps)]);
    expect([a.kind, b.kind].sort()).toEqual(["already", "sent"]);
    expect(pp.count("POST", "/v1/payments/payouts")).toBe(1);

    const row = await db().execute(sql`select p.status, p.request_id, p.recipient_type, p.recipient_wallet, p.sender_item_id, pl.status as plan_status, pl.detail->>'status' as engine_status, pl.detail->'payee'->>'masked' as masked, pl.detail::text as detail from payment p join payment_plan pl on pl.id = p.plan_id where p.claim_id = ${claimId}`);
    expect(row.rows[0]).toMatchObject({ status: "pending", request_id: `payout-${claimId}-a1`, recipient_type: "EMAIL", recipient_wallet: "PAYPAL", sender_item_id: claimId, plan_status: "executing", engine_status: "submitted", masked: "u***@example.com" });
    expect(String(row.rows[0].detail)).not.toContain("unregistered-owner@example.com");
    expect((await store.getPlanByClaim(claimId))?.payee?.value).toBe("unregistered-owner@example.com");
  });

  it("turns a looked-up UNCLAIMED webhook into a re-notice task linked to its payout batch, once", async () => {
    const payment = (await store.getPaymentByClaim(claimId))!;
    const batch = pp.batches.get(payment.payoutBatchId!)!;
    const ev = pp.setItemStatus(batch.items[0].payout_item_id, "UNCLAIMED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED");
    const id = `WH-${tag.toUpperCase().replace(/[^A-Z0-9]/g, "")}1-UNCLAIMED`;
    pp.events.delete(ev.id);
    pp.events.set(id, { ...ev, id });
    const r = await processWebhook(JSON.stringify({ ...ev, id }), new Headers(), deps);
    expect(r.body).toMatchObject({ trusted: true, verification: "lookup", result: "item:unclaimed" });
    expect((await processWebhook(JSON.stringify({ ...ev, id }), new Headers(), deps)).body).toMatchObject({ duplicate: true });

    const p = await db().execute(sql`select status, paypal_item_id from payment where claim_id = ${claimId}`);
    expect(p.rows[0]).toMatchObject({ status: "unclaimed", paypal_item_id: batch.items[0].payout_item_id });
    const tasks = await db().execute(sql`select t.kind, t.source, t.recall_number, t.dependencies, d.ref as depends_on_ref from plan_task t left join plan_task d on d.id = (t.dependencies->0->>'from')::int where t.data->>'claimId' = ${claimId}`);
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]).toMatchObject({ kind: "re_notice", source: "webhook", recall_number: recall, depends_on_ref: `payout-batch:${payment.payoutBatchId}` });
    const w = await db().execute(sql`select verified, processed_at is not null as done, error from webhook_event where event_id = ${id}`);
    expect(w.rows[0]).toMatchObject({ verified: true, done: true, error: null });
  });

  it("records a refusal as failed and a retry as a new attempt", async () => {
    await planPayment({ claimId: claim2, recallNumber: recall, recallTitle: "Test recall", decision: "verified", amountCents: 2000, payee: { type: "venmo", value: "4085550124" }, choice: "money" }, {}, deps);
    pp.override = (c) => (c.path === "/v1/payments/payouts" ? { status: 422, body: { name: "INSUFFICIENT_FUNDS" } } : undefined);
    expect((await payClaim(claim2, deps)).kind).toBe("failed");
    pp.override = null;
    const plan = (await store.getPlanByClaim(claim2))!;
    expect(plan.status).toBe("failed");
    expect((await retryPlan(plan.id, "Ana", deps)).ok).toBe(true);
    const sent = await payClaim(claim2, deps);
    expect(sent.kind === "sent" && sent.payment.issue).toBe("VENMO_SANDBOX_FALLBACK");
    const rows = await db().execute(sql`select request_id, status, recipient_wallet, error from payment where claim_id = ${claim2} order by id`);
    expect(rows.rows.map((r) => [r.request_id, r.status])).toEqual([
      [`payout-${claim2}-a1`, "failed"],
      [`payout-${claim2}-a2`, "pending"],
    ]);
    expect(rows.rows[1]).toMatchObject({ recipient_wallet: "VENMO" });
  });

  it("records one sale per shop capture, with the buyer email hashed", async () => {
    const orderId = pp.addApprovedOrder({ reference: SHOP.referenceId, customId: `${SHOP.customIdPrefix}${SHOP.product.sku}`, amount: "34.99", payerEmail: "pg-buyer@example.com", itemName: SHOP.product.name, sku: SHOP.product.sku });
    const [x, y] = await Promise.all([captureShopOrder(orderId, "person", deps), captureShopOrder(orderId, "webhook", deps)]);
    expect([x.kind, y.kind]).toContain("captured");
    const s = await db().execute(sql`select source, amount, buyer_email_hash, firm_id from sale where paypal_order_id = ${orderId}`);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ source: "shop", amount: "34.99" });
    expect(String(s.rows[0].buyer_email_hash)).toMatch(/^[0-9a-f]{64}$/);
  });
});
