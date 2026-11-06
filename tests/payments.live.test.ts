import { describe, expect, it } from "vitest";
import { approveAsBuyer } from "../scripts/payments/approve-as-buyer";
import { memoryLedger, type PaymentsDeps } from "@/lib/payments/deps";
import { getPayoutBatch } from "@/lib/payments/payouts";
import { hasPriorRefund } from "@/lib/payments/refunds";
import { payClaim, planPayment } from "@/lib/payments/router";
import { captureShopOrder, createShopOrder, hashBuyerEmail } from "@/lib/payments/shop";
import { MemoryStore } from "@/lib/payments/store";
import type { Rest } from "@/lib/payments/types";

/**
 * Live PayPal sandbox run, skipped without sandbox keys. Load .env.local first, for example:
 *   node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/payments.live.test.ts
 * It uses an in-memory store (no database) and moves $35.99 of sandbox money at most:
 *   1. a $1.00 payout to SANDBOX_BUYER_EMAIL, polled until PayPal says SUCCESS;
 *   2. one shop purchase of the $34.99 power bank, approved by the sandbox buyer logging in to PayPal in Chrome
 *      (redirect checkout, scripts/payments/approve-as-buyer.ts),
 *      captured by the server, then refunded to that capture through the router. hasPriorRefund (C6) passes before
 *      the refund and fails after it.
 * Card approval is not used for the shop: on Nov 5, 2026 this sandbox account refused every
 * test card with PAYER_CANNOT_PAY at $34.99, while approving the same cards at $20.
 */
const live = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.SANDBOX_BUYER_EMAIL);
const buyerLogin = Boolean(process.env.SANDBOX_BUYER_PASSWORD);

async function liveDeps(): Promise<Partial<PaymentsDeps>> {
  const { paypalRest } = await import("@/lib/paypal/client");
  const { ledger } = memoryLedger();
  return { store: new MemoryStore(), ledger, rest: paypalRest as Rest, firm: { id: "1", name: "Brightline Home (sample)" } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!live)("PayPal sandbox, live", () => {
  it("pays one $1.00 payout to the sandbox buyer and sees it succeed", async () => {
    const deps = await liveDeps();
    const claimId = `live-${Date.now().toString(36)}`;
    const p = await planPayment(
      { claimId, recallNumber: "26055", recallTitle: "PowerCell 10K power banks (sample)", decision: "verified", amountCents: 100, payee: { type: "email", value: process.env.SANDBOX_BUYER_EMAIL! }, choice: "money" },
      {},
      deps,
    );
    expect(p.ok && p.plan.route).toBe("payout");
    const r = await payClaim(claimId, deps);
    expect(r.kind).toBe("sent");
    if (r.kind !== "sent") return;
    expect((await payClaim(claimId, deps)).kind).toBe("already");
    let status = "PENDING";
    for (let i = 0; i < 12 && status !== "SUCCESS"; i++) {
      await sleep(5000);
      const b = await getPayoutBatch(r.payment.payoutBatchId!, deps);
      status = b.ok ? (b.batch.items[0]?.paypalStatus ?? "PENDING") : "ERROR";
    }
    console.log(`payout batch ${r.payment.payoutBatchId} sender ${r.payment.senderBatchId} item status ${status}`);
    expect(status).toBe("SUCCESS");
  }, 90_000);

  it.skipIf(!buyerLogin)("buys the sample power bank as the buyer, captures it, and refunds it to that capture", async () => {
    const deps = await liveDeps();
    const returnUrl = "http://localhost:3300/shop/return";
    const order = await createShopOrder({ returnUrl, cancelUrl: returnUrl }, deps);
    expect(order.ok).toBe(true);
    if (!order.ok) return;
    const back = await approveAsBuyer(order.approveUrl!, returnUrl);
    expect(back.token).toBe(order.id);
    const cap = await captureShopOrder(order.id, "person", deps);
    expect(cap.kind).toBe("captured");
    if (cap.kind !== "captured") return;
    expect(cap.sale.buyerEmailHash).toBe(hashBuyerEmail(process.env.SANDBOX_BUYER_EMAIL!));
    expect(cap.sale.amountCents).toBe(3499);
    const captureId = cap.sale.paypalCaptureId!;
    expect((await captureShopOrder(order.id, "person", deps)).kind).toBe("already");

    expect(await hasPriorRefund(captureId, deps)).toMatchObject({ found: true, refunded: false, pass: true });

    const claimId = `live-r-${Date.now().toString(36)}`;
    const p = await planPayment(
      { claimId, recallNumber: "26055", recallTitle: "PowerCell 10K power banks (sample)", decision: "verified", amountCents: 3499, payee: { type: "email", value: process.env.SANDBOX_BUYER_EMAIL! }, choice: "money", linkedCaptureId: captureId },
      {},
      deps,
    );
    expect(p.ok && p.plan.route).toBe("refund");
    const r = await payClaim(claimId, deps);
    expect(r.kind).toBe("sent");
    if (r.kind !== "sent") return;
    console.log(`shop order ${order.id} capture ${captureId} refund ${r.payment.refundId} status ${r.payment.paypalStatus}`);
    expect(r.payment.refundId).toBeTruthy();
    expect((await payClaim(claimId, deps)).kind).toBe("already");
    expect(await hasPriorRefund(captureId, deps)).toMatchObject({ refunded: true, fullyRefunded: true, pass: false });
  }, 180_000);
});
