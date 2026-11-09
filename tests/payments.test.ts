import { afterEach, describe, expect, it } from "vitest";
import { findBuyers, matchItem, sliceWindows } from "@/lib/payments/buyers";
import { memoryLedger, type PaymentsDeps } from "@/lib/payments/deps";
import { onPaymentEvent, type PaymentEvent } from "@/lib/payments/events";
import { FakePayPal } from "@/lib/payments/fake-paypal";
import { buildPayoutBatch, cancelPayoutItem, normalizeUsPhone, recipientFor, senderBatchIdFor } from "@/lib/payments/payouts";
import { reconcileOpenPayments, refreshPayment } from "@/lib/payments/reconcile";
import { c6Check, hasPriorRefund, priorRefundCheck, refundWindow } from "@/lib/payments/refunds";
import type { PriorRefundCheck } from "@/lib/verify/types";
import { approvePlan, chooseRoute, executePlan, maskPayee, payClaim, payClaims, paymentSummary, planPayment, retryPlan, type ClaimForPayment } from "@/lib/payments/router";
import { captureShopOrder, createShopOrder, hashBuyerEmail } from "@/lib/payments/shop";
import { SHOP } from "@/lib/payments/shop-catalog";
import { describeStatus, payoutItemStatus, plainIssue } from "@/lib/payments/status";
import { MemoryStore } from "@/lib/payments/store";
import type { PaymentStatus } from "@/lib/payments/types";
import { processWebhook } from "@/lib/payments/webhooks";

const NOW = new Date("2026-11-05T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function setup() {
  const pp = new FakePayPal();
  const store = new MemoryStore();
  const { ledger, events } = memoryLedger();
  const deps: Partial<PaymentsDeps> = { store, ledger, rest: pp.rest, now: () => NOW, firm: { id: "1", name: "Brightline Home (sample)" } };
  return { pp, store, ledger: events, deps };
}

const claim = (over: Partial<ClaimForPayment> = {}): ClaimForPayment => ({
  claimId: "c-1",
  recallNumber: "26055",
  recallTitle: "PowerCell 10K power banks",
  decision: "verified",
  amountCents: 3499,
  payee: { type: "email", value: "Jordan@Example.com" },
  choice: "money",
  linkedCaptureId: null,
  ...over,
});

const unsubs: (() => void)[] = [];
afterEach(() => unsubs.splice(0).forEach((u) => u()));

describe("status mapping", () => {
  it("maps every PayPal payout item status to a Remedy status", () => {
    const cases: [string, PaymentStatus][] = [
      ["SUCCESS", "paid"],
      ["SUCCEEDED", "paid"],
      ["UNCLAIMED", "unclaimed"],
      ["PENDING", "sending"],
      ["RETURNED", "returned"],
      ["FAILED", "failed"],
      ["BLOCKED", "blocked"],
      ["ONHOLD", "on_hold"],
      ["HELD", "on_hold"],
      ["CANCELED", "canceled"],
      ["REFUNDED", "reversed"],
      ["DENIED", "failed"],
      ["something new", "sending"],
    ];
    for (const [pp, want] of cases) expect(payoutItemStatus(pp), pp).toBe(want);
  });

  it("words each status plainly, for the route", () => {
    expect(describeStatus("paid", "refund").plain).toBe("Refunded to the account they paid with.");
    expect(describeStatus("paid", "replacement").label).toBe("Replacement paid");
    expect(describeStatus("unclaimed").followUp).toBe(true);
    expect(describeStatus("returned").followUp).toBe(true);
    expect(describeStatus("sending").final).toBe(false);
    const all: PaymentStatus[] = ["sending", "paid", "unclaimed", "returned", "failed", "blocked", "on_hold", "canceled", "reversed"];
    for (const s of all) {
      const t = describeStatus(s).plain + describeStatus(s).label;
      expect(t).not.toMatch(/—|fraud|fake/i);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(plainIssue("RECEIVER_UNREGISTERED")).toContain("link to accept");
    expect(plainIssue("NOPE")).toContain("Please try again");
  });
});

describe("payout requests", () => {
  it("normalizes email, US phone and Venmo recipients", () => {
    expect(recipientFor({ type: "email", value: " Jordan@Example.COM " })).toEqual({ recipient_type: "EMAIL", receiver: "jordan@example.com" });
    expect(recipientFor({ type: "phone", value: "+1 (408) 555-0123" })).toEqual({ recipient_type: "PHONE", receiver: "4085550123" });
    expect(recipientFor({ type: "venmo", value: "408-555-0124" })).toEqual({ recipient_type: "PHONE", receiver: "4085550124", recipient_wallet: "VENMO" });
    expect(recipientFor({ type: "venmo", value: "408-555-0124" }, { venmoWallet: false })).toEqual({ recipient_type: "PHONE", receiver: "4085550124" });
    expect(recipientFor({ type: "email", value: "not-an-email" })).toHaveProperty("error");
    expect(normalizeUsPhone("123")).toBeNull();
    expect(normalizeUsPhone("0085550123")).toBeNull();
  });

  it("derives the batch id from the claims and attempts, in any order", () => {
    expect(senderBatchIdFor([{ claimId: "c-1", attempt: 1 }])).toBe("rmd-c-1-a1");
    expect(senderBatchIdFor([{ claimId: "c-1", attempt: 2 }])).toBe("rmd-c-1-a2");
    const a = senderBatchIdFor([{ claimId: "c-1", attempt: 1 }, { claimId: "c-2", attempt: 1 }]);
    const b = senderBatchIdFor([{ claimId: "c-2", attempt: 1 }, { claimId: "c-1", attempt: 1 }]);
    expect(a).toBe(b);
    expect(a).toMatch(/^rmd-bulk-[0-9a-f]{24}$/);
  });

  it("names the recall and the sandbox in every item, with the claim as sender_item_id", () => {
    const body = buildPayoutBatch([{ claimId: "c-1", amountCents: 3499, payee: { type: "email", value: "a@b.co" }, recallNumber: "26055", recallTitle: "PowerCell 10K power banks" }], {
      senderBatchId: "rmd-c-1-a1",
      firmName: "Brightline Home (sample)",
      venmoWallet: true,
    });
    expect(body.items[0]).toMatchObject({ sender_item_id: "c-1", amount: { value: "34.99", currency: "USD" } });
    expect(body.items[0].note).toContain("CPSC recall 26055");
    expect(body.items[0].note).toContain("Demonstration in PayPal sandbox");
    expect(body.sender_batch_header.sender_batch_id).toBe("rmd-c-1-a1");
  });
});

describe("180-day refund window", () => {
  it("includes day 0 and day 180, excludes day 181 and the future", () => {
    expect(refundWindow(daysAgo(0), NOW).within).toBe(true);
    expect(refundWindow(daysAgo(180), NOW).within).toBe(true);
    expect(refundWindow(daysAgo(180), NOW).daysLeft).toBe(0);
    expect(refundWindow(daysAgo(181), NOW).within).toBe(false);
    expect(refundWindow(new Date(NOW.getTime() + 86_400_000), NOW).within).toBe(false);
    expect(refundWindow(daysAgo(30), NOW)).toMatchObject({ ageDays: 30, daysLeft: 150 });
  });
});

describe("router: choosing the route", () => {
  const capture = (o: Partial<{ capturedAt: string; refunded: boolean; disputed: boolean; found: boolean; remainingCents: number }> = {}) => ({
    id: "CAP1",
    found: true,
    capturedAt: daysAgo(12),
    remainingCents: 3499,
    refunded: false,
    disputed: false,
    ...o,
  });
  const payee = { type: "email" as const, value: "a@b.co" };
  const replacement = { productId: "p1", title: "Safe power bank", priceCents: 2999, retailer: "Retailer", noActiveRecall: true };

  it("refunds a linked capture inside 180 days", () => {
    const r = chooseRoute({ choice: "money", capture: capture(), replacement: null, payee, now: NOW });
    expect(r.route).toBe("refund");
    expect(r.plain).toContain("12 days ago");
  });
  it("refunds before a replacement when the capture is refundable (the router's order)", () => {
    expect(chooseRoute({ choice: "replacement", capture: capture(), replacement, payee, now: NOW }).route).toBe("refund");
  });
  it("pays out after the window, after a refund, or with a dispute", () => {
    expect(chooseRoute({ choice: "money", capture: capture({ capturedAt: daysAgo(181) }), replacement: null, payee, now: NOW })).toMatchObject({ route: "payout" });
    expect(chooseRoute({ choice: "money", capture: capture({ capturedAt: daysAgo(181) }), replacement: null, payee, now: NOW }).plain).toContain("more than 180 days");
    expect(chooseRoute({ choice: "money", capture: capture({ refunded: true }), replacement: null, payee, now: NOW }).route).toBe("payout");
    expect(chooseRoute({ choice: "money", capture: capture({ disputed: true }), replacement: null, payee, now: NOW }).route).toBe("payout");
  });
  it("orders a replacement only when one is chosen and confirmed free of recalls", () => {
    expect(chooseRoute({ choice: "replacement", capture: null, replacement, payee, now: NOW }).route).toBe("replacement");
    expect(chooseRoute({ choice: "replacement", capture: null, replacement: { ...replacement, noActiveRecall: false }, payee, now: NOW }).route).toBe("payout");
  });
  it("asks for a payee when there is nowhere to send money", () => {
    expect(chooseRoute({ choice: "money", capture: null, replacement: null, payee: null, now: NOW }).route).toBeNull();
  });
});

describe("router: plans", () => {
  it("auto-approves a verified claim at or under the cap, and is idempotent per claim", async () => {
    const { deps, ledger } = setup();
    const a = await planPayment(claim(), { autoCapCents: 5000 }, deps);
    expect(a.ok && a.plan.status).toBe("approved");
    expect(a.ok && a.plan.approval?.by).toBe("auto_rule");
    const b = await planPayment(claim({ amountCents: 1000 }), {}, deps);
    expect(b.ok && b.created).toBe(false);
    expect(b.ok && b.plan.amountCents).toBe(3499);
    expect(ledger.filter((e) => e.action === "payment.plan_created")).toHaveLength(1);
  });
  it("leaves firm_review and over-cap claims for a reviewer, and never pays a retake", async () => {
    const { deps } = setup();
    const review = await planPayment(claim({ claimId: "c-2", decision: "firm_review" }), {}, deps);
    expect(review.ok && review.plan.status).toBe("awaiting_approval");
    const overCap = await planPayment(claim({ claimId: "c-3" }), { autoCapCents: 2000 }, deps);
    expect(overCap.ok && overCap.plan.status).toBe("awaiting_approval");
    const retake = await planPayment(claim({ claimId: "c-4", decision: "retake" }), {}, deps);
    expect(retake).toMatchObject({ ok: false, code: "not_payable" });
    const big = await planPayment(claim({ claimId: "c-5", amountCents: 9999 }), {}, deps);
    expect(big).toMatchObject({ ok: false, code: "over_limit" });
    const bad = await planPayment(claim({ claimId: "c-6", payee: { type: "phone", value: "12" } }), {}, deps);
    expect(bad).toMatchObject({ ok: false, code: "invalid_payee" });
  });
  it("refunds no more than is left on the capture", async () => {
    const { deps, pp } = setup();
    const { captureId } = pp.addCapture({ amount: "20.00", createTime: daysAgo(3) });
    const r = await planPayment(claim({ linkedCaptureId: captureId }), {}, deps);
    expect(r.ok && r.plan.route).toBe("refund");
    expect(r.ok && r.plan.amountCents).toBe(2000);
  });
});

describe("router: paying exactly once", () => {
  it("a second pay on the same claim returns the first payment and calls PayPal once", async () => {
    const { deps, pp } = setup();
    await planPayment(claim(), {}, deps);
    const first = await payClaim("c-1", deps);
    expect(first.kind).toBe("sent");
    const second = await payClaim("c-1", deps);
    expect(second.kind).toBe("already");
    expect(pp.count("POST", "/v1/payments/payouts")).toBe(1);
    expect(first.kind === "sent" && first.payment.senderItemId).toBe("c-1");
  });

  it("two pays at the same moment still send one payout", async () => {
    const { deps, pp } = setup();
    await planPayment(claim(), {}, deps);
    const results = await Promise.all([payClaim("c-1", deps), payClaim("c-1", deps), payClaim("c-1", deps)]);
    expect(results.filter((r) => r.kind === "sent")).toHaveLength(1);
    expect(pp.count("POST", "/v1/payments/payouts")).toBe(1);
  });

  it("refunds to the original capture once, with the claim's PayPal-Request-Id", async () => {
    const { deps, pp, store } = setup();
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: daysAgo(10) });
    await planPayment(claim({ linkedCaptureId: captureId }), {}, deps);
    const r = await payClaim("c-1", deps);
    expect(r.kind).toBe("sent");
    expect(r.kind === "sent" && r.payment.status).toBe("paid");
    expect(pp.calls.find((c) => c.path.endsWith("/refund"))?.requestId).toBe("refund-c-1-a1");
    expect((await store.getPlanByClaim("c-1"))?.status).toBe("paid");
    await payClaim("c-1", deps);
    expect(pp.count("POST", "/v2/payments/captures")).toBe(1);
    expect(pp.captures.get(captureId)?.status).toBe("REFUNDED");
  });

  it("waits for a reviewer, then pays", async () => {
    const { deps } = setup();
    const p = await planPayment(claim({ decision: "firm_review" }), {}, deps);
    expect((await payClaim("c-1", deps)).kind).toBe("needs_approval");
    const ok = await approvePlan(p.ok ? p.plan.id : "", "Ana", deps);
    expect(ok.ok && ok.plan.approval).toMatchObject({ by: "reviewer", who: "Ana" });
    expect((await payClaim("c-1", deps)).kind).toBe("sent");
  });

  it("after a refusal, a retry is a new attempt with a new batch id", async () => {
    const { deps, pp } = setup();
    const p = await planPayment(claim(), {}, deps);
    pp.override = (c) => (c.method === "POST" && c.path === "/v1/payments/payouts" ? { status: 422, body: { name: "INSUFFICIENT_FUNDS" } } : undefined);
    const r = await payClaim("c-1", deps);
    expect(r).toMatchObject({ kind: "failed", issue: "INSUFFICIENT_FUNDS" });
    expect((await payClaim("c-1", deps)).kind).toBe("not_payable");
    pp.override = null;
    const again = await retryPlan(p.ok ? p.plan.id : "", "Ana", deps);
    expect(again.ok && again.plan.attempt).toBe(2);
    const sent = await payClaim("c-1", deps);
    expect(sent.kind).toBe("sent");
    const ids = pp.calls.filter((c) => c.path === "/v1/payments/payouts").map((c) => c.requestId);
    expect(ids).toEqual(["rmd-c-1-a1", "rmd-c-1-a2"]);
  });

  it("when PayPal does not answer, the next pay resends the same ids (PayPal dedupes)", async () => {
    const { deps, pp } = setup();
    await planPayment(claim(), {}, deps);
    let fails = 3;
    pp.override = (c) => (c.path === "/v1/payments/payouts" && fails-- > 0 ? { status: 503, body: { name: "SERVICE_UNAVAILABLE" } } : undefined);
    const r = await payClaim("c-1", deps);
    expect(r.kind).toBe("retry_later");
    const s = await payClaim("c-1", deps);
    expect(s.kind).toBe("sent");
    const ids = new Set(pp.calls.filter((c) => c.path === "/v1/payments/payouts").map((c) => c.requestId));
    expect([...ids]).toEqual(["rmd-c-1-a1"]);
    expect(pp.batches.size).toBe(1);
  }, 20_000);

  it("recovers a batch whose answer was lost, from PayPal's duplicate refusal, instead of paying again", async () => {
    const { deps, pp, ledger } = setup();
    await planPayment(claim(), {}, deps);
    pp.loseResponseTo = "/v1/payments/payouts";
    const r = await payClaim("c-1", deps);
    expect(r.kind).toBe("sent");
    expect(pp.batches.size).toBe(1);
    const only = [...pp.batches.values()][0].header.payout_batch_id;
    expect(r.kind === "sent" && r.payment.payoutBatchId).toBe(only);
    expect(ledger.find((e) => e.action === "paypal.payout.created")?.detail).toMatchObject({ existing_batch: true });
  });

  it("bulk pays many claims in one batch and never resends", async () => {
    const { deps, pp } = setup();
    for (const id of ["c-1", "c-2", "c-3"]) await planPayment(claim({ claimId: id }), {}, deps);
    const out = await payClaims(["c-1", "c-2", "c-3", "c-2"], deps);
    expect(out.map((o) => o.result.kind)).toEqual(["sent", "sent", "sent"]);
    expect(pp.count("POST", "/v1/payments/payouts")).toBe(1);
    expect([...pp.batches.values()][0].items).toHaveLength(3);
    const again = await payClaims(["c-1", "c-2", "c-3"], deps);
    expect(again.every((o) => o.result.kind === "already")).toBe(true);
    expect(pp.count("POST", "/v1/payments/payouts")).toBe(1);
  });

  it("resends a Venmo item as a PayPal phone item when the sandbox refuses the wallet", async () => {
    const { deps, pp } = setup();
    const p = await planPayment(claim({ payee: { type: "venmo", value: "4085550124" } }), {}, deps);
    expect(p.ok && p.plan.reasons.plain).toContain("Venmo payouts need live PayPal");
    const r = await payClaim("c-1", deps);
    expect(r.kind === "sent" && r.payment.issue).toBe("VENMO_SANDBOX_FALLBACK");
    const sent = pp.calls.filter((c) => c.path === "/v1/payments/payouts");
    expect(sent.map((c) => c.requestId)).toEqual(["rmd-c-1-a1", "rmd-c-1-a1-pp"]);
    expect((sent[1].body as { items: Record<string, unknown>[] }).items[0].recipient_wallet).toBeUndefined();
  });

  it("orders a replacement from the retailer stand-in", async () => {
    process.env.PAYPAL_VENDOR_EMAIL ??= "retailer@example.com";
    const { deps, pp } = setup();
    await planPayment(claim({ choice: "replacement", replacement: { productId: "p1", title: "Safe power bank", priceCents: 2999, retailer: "Retailer", noActiveRecall: true } }), {}, deps);
    const r = await payClaim("c-1", deps);
    expect(r.kind === "sent" && r.payment).toMatchObject({ route: "replacement", status: "paid" });
    const order = pp.calls.find((c) => c.method === "POST" && c.path === "/v2/checkout/orders");
    expect(order?.requestId).toBe("replace-c-1-a1");
    expect((order?.body as { purchase_units: { payee: { email_address: string } }[] }).purchase_units[0].payee.email_address).toBe(process.env.PAYPAL_VENDOR_EMAIL);
  });

  it("holds payments past the daily sandbox limit", async () => {
    const { deps } = setup();
    for (let i = 0; i < 15; i++) {
      await planPayment(claim({ claimId: `d-${i}`, amountCents: 4000 }), {}, deps);
      const r = await payClaim(`d-${i}`, deps);
      if (i < 12) expect(r.kind, `claim ${i}`).toBe("sent");
      else expect(r.kind, `claim ${i}`).toBe("limit");
    }
  });

  it("summarizes a claim's payment with a masked payee", async () => {
    const { deps } = setup();
    await planPayment(claim(), {}, deps);
    await executePlan((await paymentSummary("c-1", deps)).plan!.id, deps);
    const s = await paymentSummary("c-1", deps);
    expect(s.payee).toEqual({ type: "email", masked: "j***n@example.com" });
    expect(s.status?.label).toBe("On its way");
    expect(maskPayee({ type: "phone", value: "408-555-0123" })).toBe("***-***-0123");
  });
});

describe("webhooks", () => {
  async function paidOut(receiver = "unregistered-owner@example.com") {
    const s = setup();
    await planPayment(claim({ payee: { type: "email", value: receiver } }), {}, s.deps);
    const r = await payClaim("c-1", s.deps);
    if (r.kind !== "sent") throw new Error(r.kind);
    const batch = [...s.pp.batches.values()][0];
    return { ...s, payment: r.payment, item: batch.items[0] };
  }

  it("a looked-up UNCLAIMED event updates the payment, adds one re-notice task and emits once", async () => {
    const { deps, pp, store, item } = await paidOut();
    const seen: PaymentEvent[] = [];
    unsubs.push(onPaymentEvent((e) => void seen.push(e)));
    const ev = pp.setItemStatus(item.payout_item_id, "UNCLAIMED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED");
    const r = await processWebhook(JSON.stringify(ev), new Headers(), deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ trusted: true, verification: "lookup", result: "item:unclaimed" });
    expect((await store.getPaymentByClaim("c-1"))?.status).toBe("unclaimed");
    const tasks = await store.listPlanTasks({ kind: "re_notice" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ source: "webhook", dependsOn: expect.stringMatching(/^payout-batch:/) });
    expect(seen.map((e) => e.kind)).toEqual(["unclaimed"]);
    expect(seen[0].task?.kind).toBe("re_notice");
    const again = await processWebhook(JSON.stringify(ev), new Headers(), deps);
    expect(again.body).toMatchObject({ duplicate: true });
    expect(await store.listPlanTasks({ kind: "re_notice" })).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  it("ignores an event PayPal has no record of, and changes nothing", async () => {
    const { deps, store, item } = await paidOut("jordan@example.com");
    const forged = { id: "WH-1234567890ABCDEFGHIJ-XYZ", event_type: "PAYMENT.PAYOUTS-ITEM.RETURNED", resource: { ...item, transaction_status: "RETURNED" } };
    const r = await processWebhook(JSON.stringify(forged), new Headers(), deps);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ trusted: false });
    expect((await store.getPaymentByClaim("c-1"))?.status).toBe("sending");
    expect((await store.getWebhookEvent(forged.id))?.result).toBe("ignored_untrusted");
    expect(await store.listPlanTasks({ kind: "re_notice" })).toHaveLength(0);
  });

  it("trusts a valid signature, and acts on PayPal's current item status", async () => {
    const { deps, pp, store, item } = await paidOut("jordan@example.com");
    process.env.PAYPAL_WEBHOOK_ID ??= "WH-TEST";
    const ev = pp.setItemStatus(item.payout_item_id, "SUCCESS", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    pp.events.delete(ev.id); // Not on record: only the signature can make it trusted.
    const headers = new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.paypal.com/cert", "paypal-transmission-id": "t1", "paypal-transmission-sig": "good-signature", "paypal-transmission-time": NOW.toISOString() });
    const r = await processWebhook(JSON.stringify(ev), headers, deps);
    expect(r.body).toMatchObject({ trusted: true, verification: "signature", result: "item:paid" });
    expect((await store.getPaymentByClaim("c-1"))?.status).toBe("paid");
    expect((await store.getPlanByClaim("c-1"))?.status).toBe("paid");
  });

  it("marks a refund paid from PAYMENT.CAPTURE.REFUNDED", async () => {
    const { deps, pp, store } = setup();
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: daysAgo(5) });
    await planPayment(claim({ linkedCaptureId: captureId }), {}, deps);
    const payment = await store.insertPayment({
      ...(await (async () => {
        const plan = (await store.getPlanByClaim("c-1"))!;
        return { id: "pay-x", planId: plan.id, claimId: "c-1", attempt: 1, requestId: "refund-c-1-a1", firmId: "1", route: "refund" as const, amountCents: 3499, currency: "USD" as const };
      })()),
      status: "sending",
      paypalStatus: "PENDING",
      payeeType: null,
      senderBatchId: null,
      senderItemId: null,
      payoutBatchId: null,
      payoutItemId: null,
      transactionId: null,
      captureId,
      refundId: "R9",
      orderId: null,
      debugId: null,
      issue: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const ev = { id: "WH-REFUND0000000001-AAAA", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "R9", status: "COMPLETED", links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] } };
    pp.events.set(ev.id, ev);
    const r = await processWebhook(JSON.stringify(ev), new Headers(), deps);
    expect(r.body).toMatchObject({ result: "refund:paid" });
    expect((await store.getPayment(payment.payment.id))?.status).toBe("paid");
  });

  it("captures an approved shop order from CHECKOUT.ORDER.APPROVED, once", async () => {
    const { deps, pp, store } = setup();
    const orderId = pp.addApprovedOrder({ reference: SHOP.referenceId, customId: `${SHOP.customIdPrefix}${SHOP.product.sku}`, amount: "34.99", payerEmail: "buyer@example.com", itemName: SHOP.product.name, sku: SHOP.product.sku });
    const ev = { id: "WH-APPROVED00000001-AAAA", event_type: "CHECKOUT.ORDER.APPROVED", resource: pp.orders.get(orderId) };
    pp.events.set(ev.id, ev);
    const r = await processWebhook(JSON.stringify(ev), new Headers(), deps);
    expect(r.body).toMatchObject({ result: "shop:captured" });
    expect((await store.getSaleByOrder(orderId))?.buyerEmailHash).toBe(hashBuyerEmail("Buyer@Example.com"));
    const viaPage = await captureShopOrder(orderId, "person", deps);
    expect(viaPage.kind).toBe("already");
    expect(pp.count("POST", `/v2/checkout/orders/${orderId}/capture`)).toBe(1);
  });
});

describe("C6: prior refunds and disputes", () => {
  it("passes a clean capture and fails refunded, disputed or missing ones", async () => {
    const { deps, pp, store } = setup();
    const clean = pp.addCapture({ amount: "34.99", createTime: daysAgo(4) });
    const r = await hasPriorRefund(clean.captureId, deps);
    expect(r).toMatchObject({ found: true, refunded: false, pass: true, plain: "No earlier refund or dispute." });
    expect(r.calls.some((c) => c.startsWith("GET /v1/customer/disputes"))).toBe(true);

    const partial = pp.addCapture({ amount: "34.99", createTime: daysAgo(4) });
    await pp.rest(`/v2/payments/captures/${partial.captureId}/refund`, { method: "POST", body: JSON.stringify({ amount: { value: "10.00" } }) });
    const p = await hasPriorRefund(partial.captureId, deps);
    expect(p).toMatchObject({ refunded: true, fullyRefunded: false, refundedCents: 1000, remainingCents: 2499, pass: false });

    const disputed = pp.addCapture({ amount: "34.99", createTime: daysAgo(4) });
    pp.disputes.set(disputed.captureId, [{ dispute_id: "PP-D-1", status: "OPEN" }]);
    expect(await hasPriorRefund(disputed.captureId, deps)).toMatchObject({ pass: false, disputes: { count: 1, open: 1 } });

    expect(await hasPriorRefund("NOPE12345", deps)).toMatchObject({ found: false, pass: false });

    pp.disputesStatus = 403;
    const noScope = await hasPriorRefund(clean.captureId, deps);
    expect(noScope).toMatchObject({ pass: true, plain: "No earlier refund.", disputes: { checked: false } });
    expect(noScope.disputes.note).toContain("disputes read scope");

    // A refund Remedy made that PayPal's copy does not show yet still counts.
    await store.insertPayment({ id: "p1", planId: "x", claimId: "c-9", attempt: 1, requestId: "refund-c-9-a1", firmId: "1", route: "refund", amountCents: 3499, currency: "USD", status: "sending", paypalStatus: null, payeeType: null, senderBatchId: null, senderItemId: null, payoutBatchId: null, payoutItemId: null, transactionId: null, captureId: clean.captureId, refundId: null, orderId: null, debugId: null, issue: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(await hasPriorRefund(clean.captureId, deps)).toMatchObject({ refunded: true, pass: false });
  });

  it("gives the verification engine its C6 hook, in its own type", async () => {
    const { deps, pp } = setup();
    expect(await c6Check(null, deps)).toMatchObject({ pass: true, reason_plain: "No PayPal purchase linked." });
    const hook: PriorRefundCheck = (id) => priorRefundCheck(id, deps);
    const clean = pp.addCapture({ amount: "34.99", createTime: daysAgo(2) });
    expect(await hook(clean.captureId)).toMatchObject({ refunded: false, disputed: false, plain: "No earlier refund or dispute." });
    const disputed = pp.addCapture({ amount: "34.99", createTime: daysAgo(2) });
    pp.disputes.set(disputed.captureId, [{ dispute_id: "PP-D-2", status: "UNDER_REVIEW" }]);
    expect(await hook(disputed.captureId)).toMatchObject({ refunded: false, disputed: true });
    await expect(hook("MISSING1234")).rejects.toThrow();
  });
});

describe("cancel and reconcile", () => {
  it("cancels only an unclaimed item, and reconciles open payouts by polling", async () => {
    const { deps, store } = setup();
    await planPayment(claim({ payee: { type: "email", value: "unregistered@example.com" } }), {}, deps);
    await planPayment(claim({ claimId: "c-2" }), {}, deps);
    await payClaim("c-1", deps);
    await payClaim("c-2", deps);
    const rep = await reconcileOpenPayments(deps);
    expect(rep).toMatchObject({ open: 2, batches: 2, changed: 2 });
    expect((await store.getPaymentByClaim("c-1"))?.status).toBe("unclaimed");
    expect((await store.getPaymentByClaim("c-2"))?.status).toBe("paid");
    expect(await store.listPlanTasks({ kind: "re_notice" })).toHaveLength(1);

    const paidItem = (await store.getPaymentByClaim("c-2"))!.payoutItemId!;
    expect(await cancelPayoutItem(paidItem, deps)).toMatchObject({ ok: false, issue: "ITEM_INCORRECT_STATUS" });
    const unclaimedItem = (await store.getPaymentByClaim("c-1"))!.payoutItemId!;
    expect(await cancelPayoutItem(unclaimedItem, deps)).toMatchObject({ ok: true, status: "returned" });
    expect((await store.getPaymentByClaim("c-1"))?.status).toBe("returned");
    expect((await store.getPlanByClaim("c-1"))?.status).toBe("failed");
    expect(await store.listPlanTasks({ kind: "re_notice" })).toHaveLength(2);
    expect((await reconcileOpenPayments(deps)).open).toBe(0);
  });
});

describe("refresh one claim", () => {
  it("brings a waiting payout up to date for the page that shows it", async () => {
    const { deps, pp } = setup();
    await planPayment(claim(), {}, deps);
    await payClaim("c-1", deps);
    expect((await refreshPayment("c-1", deps))?.status).toBe("paid");
    const calls = pp.calls.length;
    expect((await refreshPayment("c-1", deps))?.status).toBe("paid");
    expect(pp.calls.length).toBe(calls);
    expect(await refreshPayment("no-such-claim", deps)).toBeNull();
  });
});

describe("sample shop", () => {
  it("creates an order for the $34.99 power bank and refuses to capture other orders", async () => {
    const { deps, pp } = setup();
    const o = await createShopOrder({ returnUrl: "http://localhost:3300/shop/done" }, deps);
    expect(o).toMatchObject({ ok: true, amountCents: 3499 });
    const body = pp.calls.find((c) => c.path === "/v2/checkout/orders")!.body as { purchase_units: { reference_id: string; amount: { value: string }; payee?: unknown }[] };
    expect(body.purchase_units[0]).toMatchObject({ reference_id: SHOP.referenceId, amount: { value: "34.99" } });
    expect(body.purchase_units[0].payee).toBeUndefined();
    const foreign = pp.addApprovedOrder({ reference: "someone-else", amount: "99.00" });
    expect((await captureShopOrder(foreign, "person", deps)).kind).toBe("not_shop");
    expect(pp.count("POST", `/v2/checkout/orders/${foreign}/capture`)).toBe(0);
  });
});

describe("Transaction Search buyers", () => {
  it("cuts a range into 31-day slices", () => {
    const w = sliceWindows(new Date("2026-08-01T00:00:00Z"), new Date("2026-11-05T00:00:00Z"));
    expect(w).toHaveLength(4);
    expect(w.every((x) => x.end.getTime() - x.start.getTime() <= 31 * 86_400_000)).toBe(true);
    expect(w[0].start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.at(-1)!.end.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("scores cart lines against the product name", () => {
    const product = { name: SHOP.product.name, sku: SHOP.product.sku };
    expect(matchItem({ name: "Brightline 65W laptop charger (sample)" }, product)).toBe(1);
    expect(matchItem({ name: "65w LAPTOP-CHARGER" }, product)).toBeGreaterThanOrEqual(0.6);
    expect(matchItem({ name: "Garden hose" }, product)).toBe(0);
    expect(matchItem({ name: "x", sku: "blh-65w" }, product)).toBe(1);
  });

  it("finds matching buyers across windows, incoming payments only", async () => {
    const { deps, pp } = setup();
    const tx = (id: string, at: string, amount: string, item: string, code = "T0006") => ({
      transaction_info: { transaction_id: id, transaction_event_code: code, transaction_initiation_date: at, transaction_amount: { value: amount, currency_code: "USD" } },
      payer_info: { email_address: `${id.toLowerCase()}@example.com`, payer_name: { given_name: "Pat", surname: "Lee" } },
      cart_info: { item_details: [{ item_name: item, item_code: "", item_quantity: "1" }] },
    });
    pp.transactions = [
      tx("CAPA", daysAgo(3), "34.99", SHOP.product.name),
      tx("CAPB", daysAgo(50), "34.99", "65W laptop charger"),
      tx("CAPC", daysAgo(4), "-34.99", SHOP.product.name, "T1107"),
      tx("CAPD", daysAgo(5), "12.00", "Lamp"),
      tx("CAPE", daysAgo(200), "34.99", SHOP.product.name),
    ];
    const r = await findBuyers({ start: new Date(NOW.getTime() - 220 * 86_400_000), end: NOW, product: { name: SHOP.product.name, sku: SHOP.product.sku } }, deps);
    expect(r.buyers.map((b) => b.captureId)).toEqual(["CAPA", "CAPB", "CAPE"]);
    expect(r.buyers[0]).toMatchObject({ buyerEmail: "capa@example.com", amountCents: 3499, refundable: true });
    expect(r.buyers[2].refundable).toBe(false);
    expect(r.windows.length).toBe(8);
    expect(r.windows.every((w) => w.status === 200)).toBe(true);
  });
});
