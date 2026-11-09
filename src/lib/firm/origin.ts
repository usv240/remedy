import { sql, type SQL } from "drizzle-orm";

/**
 * Where a claim came from (claim.origin, db/schema.sql): "app" for every real and sample claim, "test" for a row a test
 * script made (scripts/payments/e2e.ts) or whose payout status it faked for the Gantt demo
 * (scripts/payments/seed-event.ts, run by tests/e2e/firm.mjs). The firm console leaves test rows out of every list and
 * count: the home tiles, the claims queue and its live feed, the monthly report, the plan's tasks and review schedule,
 * and the buyers' claim counts. tests/firm-origin.test.ts holds each of those queries to this filter. Server only.
 */
export const TEST_ORIGIN = "test" as const;
export type ClaimOrigin = "app" | typeof TEST_ORIGIN;

/** `<alias>.origin <> 'test'`, for a query over claim under that alias (a code constant, never input). */
export function notTest(alias: "c" | "claim" | "x" = "c"): SQL {
  return sql.raw(`${alias}.origin <> '${TEST_ORIGIN}'`);
}

/** A plan task that belongs to a test claim (its data.claimId), for leaving it out of the plan. */
export const notTestTask = (alias = "plan_task"): SQL =>
  sql.raw(`not exists (select 1 from claim tc where tc.id::text = ${alias}.data->>'claimId' and tc.origin = '${TEST_ORIGIN}')`);
