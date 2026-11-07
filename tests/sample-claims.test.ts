import { describe, expect, it } from "vitest";
import { READY_AMOUNT, READY_TARGET, readyPayee, sampleChecks, sampleResult } from "@/lib/firm/sample-claims";

/**
 * The sample claims the firm console keeps ready to pay: two at $1.00, to a PayPal sandbox personal account, marked
 * sample, with no model call. The Postgres part (skipped without DATABASE_URL) tops them up twice at once and checks
 * that the advisory lock keeps it to the target.
 */
describe("sample claims ready to pay", () => {
  it("are small, verified on every check, and say they are samples", () => {
    expect(READY_TARGET).toBeGreaterThanOrEqual(2);
    expect(Number(READY_AMOUNT)).toBeLessThanOrEqual(1);
    const checks = sampleChecks("paid", () => 0.5);
    expect(Object.values(checks).every((c) => c.status === "pass")).toBe(true);
    expect(checks.C2.reason_plain).toBe("The cord is cut where it meets the charger case.");
    expect(Object.values(checks).every((c) => /No model call/.test(c.reason_technical))).toBe(true);
    expect(sampleResult("verified")).toMatchObject({ decided_by: "checks", sample: true, model: null });
  });

  it("pay the sandbox buyer: SANDBOX_BUYER_EMAIL, or else the sandbox login TESTING.md publishes", async () => {
    const was = process.env.SANDBOX_BUYER_EMAIL;
    try {
      delete process.env.SANDBOX_BUYER_EMAIL;
      expect(await readyPayee()).toMatch(/@personal\.example\.com$/);
      process.env.SANDBOX_BUYER_EMAIL = "buyer@personal.example.com";
      expect(await readyPayee()).toBe("buyer@personal.example.com");
    } finally {
      if (was === undefined) delete process.env.SANDBOX_BUYER_EMAIL;
      else process.env.SANDBOX_BUYER_EMAIL = was;
    }
  });
});

describe.skipIf(!process.env.DATABASE_URL)("sample claims ready to pay, on Postgres", async () => {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { ensureReadyClaims } = await import("@/lib/firm/sample-claims");
  const { sampleFirm, SAMPLE_RECALL } = await import("@/lib/firm/firm");

  it("tops up to the target and no further, even when two requests ask at once", async () => {
    const firm = await sampleFirm();
    if (!firm) return;
    await Promise.all([ensureReadyClaims(firm.id, SAMPLE_RECALL), ensureReadyClaims(firm.id, SAMPLE_RECALL)]);
    const count = async () =>
      ((await db().execute(sql`
        select count(*)::int as n from claim c where c.firm_id = ${firm.id} and c.is_sample and c.decision = 'verified' and c.status = 'verified'
          and c.review_outcome is null and c.payee_value_enc is not null and c.amount > 0
          and not exists (select 1 from payment p where p.claim_id = c.id) and not exists (select 1 from payment_plan pp where pp.claim_id = c.id)`)).rows[0] as { n: number }).n;
    const n = await count();
    expect(n).toBeGreaterThanOrEqual(READY_TARGET);
    const again = await Promise.all([ensureReadyClaims(firm.id, SAMPLE_RECALL), ensureReadyClaims(firm.id, SAMPLE_RECALL)]);
    expect(again).toEqual([0, 0]);
    expect(await count()).toBe(n);
  });
});
