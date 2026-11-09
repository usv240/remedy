import { describe, expect, it } from "vitest";

/**
 * On Postgres (skipped without DATABASE_URL): a claim a test script made, with a payout PayPal holds as unclaimed, is
 * left out of the firm console's "Waiting to be accepted" list and count, its claim total and its queue; the same claim
 * marked 'app' shows in all of them. The rows are removed afterwards.
 */
describe.skipIf(!process.env.DATABASE_URL)("test rows on Postgres", async () => {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { firmContext } = await import("@/lib/firm/firm");
  const { homeSummary } = await import("@/lib/firm/home");
  const { queueRows } = await import("@/lib/firm/queue");

  it("a test claim with an unclaimed payout is in no list and no count; the same claim as app is", async () => {
    const ctx = await firmContext();
    if (!ctx?.main) return;
    const { firm, main, recalls } = ctx;
    const [c] = (
      await db().execute(sql`
      insert into claim (recall_number, firm_id, payee_type, payee_masked, decision, status, amount, channel, is_sample, origin)
      values (${main.number}, ${firm.id}, 'email', 'origin-test', 'verified', 'approved', 1.00, 'api', true, 'test') returning id`)
    ).rows as { id: string }[];
    try {
      const [plan] = (await db().execute(sql`insert into payment_plan (claim_id, route, amount, status) values (${c.id}::uuid, 'payout', 1.00, 'done') returning id`)).rows as { id: number }[];
      await db().execute(sql`
        insert into payment (plan_id, claim_id, route, amount, status, paypal_status, paypal_batch_id, request_id, error)
        values (${plan.id}, ${c.id}::uuid, 'payout', 1.00, 'unclaimed', 'UNCLAIMED', ${`ORIGINTEST${Date.now()}`}, ${`origin-test-${c.id}`}, '{"issue":"SEEDED_FOR_DEMO"}'::jsonb)`);
      const others = recalls.filter((r) => r.number !== main.number);
      const asTest = await homeSummary(firm, main, others);
      expect(asTest.unclaimed.map((u) => u.claimId)).not.toContain(c.id);
      expect((await queueRows(firm.id)).map((r) => r.id)).not.toContain(c.id);

      await db().execute(sql`update claim set origin = 'app' where id = ${c.id}::uuid`);
      const asApp = await homeSummary(firm, main, others);
      expect(asApp.unclaimedCount).toBe(asTest.unclaimedCount + 1);
      expect(asApp.claimsTotal).toBe(asTest.claimsTotal + 1);
      expect((await queueRows(firm.id)).map((r) => r.id)).toContain(c.id);
    } finally {
      await db().execute(sql`delete from claim where id = ${c.id}::uuid`);
    }
  });
});
