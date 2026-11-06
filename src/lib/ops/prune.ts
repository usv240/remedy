/**
 * Housekeeping for the two tables that grow with traffic: rate_limit windows older than a day and request_log rows
 * older than 7 days. Called from the code paths that write them, every PRUNE_EVERY writes, so there is no cron to
 * forget. Cheap: both deletes use the table's time index. Server only; never throws.
 */
import { sql } from "drizzle-orm";
import { db, dbConfigured } from "../db";

export const PRUNE_EVERY = 200;
export const RATE_LIMIT_KEEP = "1 day";
export const REQUEST_LOG_KEEP = "7 days";

let counter = 0;
let running: Promise<void> | null = null;

/** Count `n` writes; run the prune once every PRUNE_EVERY of them. Returns the prune's promise when it ran. */
export function maybePrune(n = 1): Promise<void> | null {
  counter += n;
  if (counter < PRUNE_EVERY || running || !dbConfigured()) return null;
  counter = 0;
  running = prune().finally(() => {
    running = null;
  });
  return running;
}

/** Delete old rows now. */
export async function prune(): Promise<void> {
  try {
    await db().execute(sql`delete from rate_limit where window_start < now() - interval '1 day'`);
    await db().execute(sql`delete from request_log where created < now() - interval '7 days'`);
  } catch {
    /* the next prune tries again */
  }
}

/** For tests. */
export function resetPruneCounter() {
  counter = 0;
}
