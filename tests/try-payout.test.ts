import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sendTryPayout, TRY_PAYOUT, type TryPayoutDeps, type TryReceipt } from "@/app/api/try/_lib/sandbox-payout";
import { LIMITS, memoryLedger, type PaymentsDeps } from "@/lib/payments/deps";
import { FakePayPal } from "@/lib/payments/fake-paypal";
import { payClaims, planPayment } from "@/lib/payments/router";
import { SHOP } from "@/lib/payments/shop-catalog";
import { MemoryStore } from "@/lib/payments/store";

/**
 * The one-click sandbox payout on /try ("Send $34.99 to the sandbox buyer"), with the fake PayPal standing in for the
 * sandbox: the payout goes through the real router (planPayment, then payClaims into one Payouts batch), to the
 * sandbox buyer, at the sample charger's refund; one a day per visitor, a site-wide count a day, and inside the
 * sandbox's shared daily ceiling, with the most recent receipt shown whenever a limit stops it.
 */
const NOW = new Date("2026-11-09T15:00:00Z");
const DAY = 86_400_000;
const BUYER = "sb-buyer@personal.example.com";

function harness(o: { paidAlreadyCents?: number; payee?: string | null } = {}) {
  const pp = new FakePayPal();
  const store = new MemoryStore();
  const { ledger, events } = memoryLedger();
  const pay: Partial<PaymentsDeps> = { store, ledger, rest: pp.rest, now: () => NOW, firm: { id: "1", name: "Brightline Home (sample)" } };
  const buckets = new Map<string, number>();
  const receipts: TryReceipt[] = [];
  let n = 0;
  const d: TryPayoutDeps = {
    payee: async () => (o.payee === undefined ? BUYER : o.payee),
    paidLast24hCents: async () => (o.paidAlreadyCents ?? 0) + (await store.sumPaymentsSince(new Date(NOW.getTime() - DAY))),
    allow: async (bucket, limit) => {
      const c = (buckets.get(bucket) ?? 0) + 1;
      buckets.set(bucket, c);
      return c <= limit;
    },
    latestReceipt: async () => receipts.at(-1) ?? null,
    openClaim: async () => `try-claim-${++n}`,
    pay: async (claimId, payee) => {
      // The same two calls payForClaim makes for every claim: plan it with the router, then pay it in one batch.
      const planned = await planPayment(
        { claimId, recallNumber: "BH-2026-01", recallTitle: SHOP.product.name, firmId: "1", decision: "verified", amountCents: TRY_PAYOUT.amountCents, payee: { type: "email", value: payee }, choice: "money", linkedCaptureId: null },
        { autoCapCents: 5000 },
        pay,
      );
      if (!planned.ok) return { ok: false, plain: planned.plain, receipt: { claimId, url: `/r/${claimId}`, batchId: null, itemId: null, status: null, statusPlain: null, at: null } };
      const [r] = await payClaims([claimId], pay);
      const p = "payment" in r.result ? r.result.payment : null;
      const receipt = { claimId, url: `/r/${claimId}`, batchId: p?.payoutBatchId ?? null, itemId: p?.payoutItemId ?? null, status: p?.paypalStatus ?? null, statusPlain: r.result.plain, at: NOW.toISOString() };
      if (p?.payoutBatchId) receipts.push(receipt);
      return { ok: r.result.kind === "sent", plain: r.result.plain, receipt };
    },
    mask: (s) => s.replace(/^(.).*(@.*)$/, "$1•••$2"),
  };
  return { pp, store, events, d };
}

describe("the one-click sandbox payout on /try", () => {
  it("sends the sample charger's $34.99 to the sandbox buyer through the router, as one Payouts item, and returns the receipt with PayPal's batch id", async () => {
    const h = harness();
    const r = await sendTryPayout({ visitorKey: "v1" }, h.d);
    expect(r.sent).toBe(true);
    if (!r.sent) return;
    expect(r).toMatchObject({ label: "Sandbox payout", amount: "$34.99", payee: "s•••@personal.example.com" });
    expect(r.receipt.url).toBe(`/r/${r.receipt.claimId}`);
    expect(r.receipt.batchId).toBeTruthy();
    expect(h.pp.count("POST", "/v1/payments/payouts")).toBe(1);
    const sent = h.pp.calls.find((c) => c.method === "POST" && c.path.startsWith("/v1/payments/payouts"))!.body as { items: { receiver: string; recipient_type: string; amount: { value: string } }[] };
    expect(sent.items).toHaveLength(1);
    expect(sent.items[0]).toMatchObject({ receiver: BUYER, recipient_type: "EMAIL", amount: { value: "34.99" } });
    expect(TRY_PAYOUT.amountCents).toBe(SHOP.product.priceCents);
  });

  it("sends one a day per visitor; the second press shows the most recent receipt and sends nothing", async () => {
    const h = harness();
    const first = await sendTryPayout({ visitorKey: "v1" }, h.d);
    const second = await sendTryPayout({ visitorKey: "v1" }, h.d);
    expect(second).toMatchObject({ sent: false, reason: "visitor" });
    expect(second.receipt?.batchId).toBe(first.receipt?.batchId);
    expect(second.plain).toMatch(/most recent sandbox payout/);
    expect(h.pp.count("POST", "/v1/payments/payouts")).toBe(1);
  });

  it("stops at the site-wide count a day, kept well inside the sandbox's daily ceiling", async () => {
    const h = harness();
    for (let i = 0; i < TRY_PAYOUT.perDay; i++) expect((await sendTryPayout({ visitorKey: `v${i}` }, h.d)).sent).toBe(true);
    const over = await sendTryPayout({ visitorKey: "another" }, h.d);
    expect(over).toMatchObject({ sent: false, reason: "day" });
    expect(over.receipt).not.toBeNull();
    expect(h.pp.count("POST", "/v1/payments/payouts")).toBe(TRY_PAYOUT.perDay);
    expect(TRY_PAYOUT.perDay * TRY_PAYOUT.amountCents).toBeLessThanOrEqual(LIMITS.perDayCents / 2);
  });

  it("sends nothing when the sandbox's shared daily ceiling would be passed, and shows the latest receipt", async () => {
    const h = harness({ paidAlreadyCents: LIMITS.perDayCents - TRY_PAYOUT.amountCents + 1 });
    const r = await sendTryPayout({ visitorKey: "v1" }, h.d);
    expect(r).toMatchObject({ sent: false, reason: "ceiling", receipt: null });
    expect(r.plain).toMatch(/sandbox payouts for today/);
    expect(h.pp.count("POST", "/v1/payments/payouts")).toBe(0);
  });

  it("sends nothing without a sandbox buyer, and says so plainly", async () => {
    const h = harness({ payee: null });
    const r = await sendTryPayout({ visitorKey: "v1" }, h.d);
    expect(r).toMatchObject({ sent: false, reason: "no_payee" });
    expect(h.pp.calls).toHaveLength(0);
  });

  it("is offered only under the verified sample charger, and labelled a sandbox payout", () => {
    const presets = readFileSync(path.join(process.cwd(), "src", "components", "try", "Presets.tsx"), "utf8");
    expect(presets).toContain('p.pay && run.result.decision === "verified"');
    const button = readFileSync(path.join(process.cwd(), "src", "components", "try", "SandboxPay.tsx"), "utf8");
    expect(button).toContain("Sandbox payout");
    expect(button).toContain("to the sandbox buyer");
    expect(TRY_PAYOUT.preset).toBe("sample-charger-cut");
  });
});
