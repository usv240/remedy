/**
 * The request log: one row per API request (route pattern, status, duration, request id, time), what /ops reads for
 * latency, error rates and the 7-day chart, and what "trace a request" looks up. No addresses, bodies or keys.
 * Rows are buffered for up to half a second and written in one insert, so a busy minute costs a few statements.
 * Kept 7 days; src/lib/ops/prune.ts removes older rows. Server only; never throws.
 */
import { db, dbConfigured, schema } from "../db";
import { maybePrune } from "./prune";

export type RequestRow = { requestId: string; route: string; status: number; ms: number };

let buffer: RequestRow[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

async function flush() {
  if (!buffer.length || !dbConfigured()) return;
  const rows = buffer;
  buffer = [];
  try {
    await db()
      .insert(schema.requestLog)
      .values(rows.map((r) => ({ requestId: r.requestId, route: r.route.slice(0, 120), status: r.status, ms: Math.max(0, Math.round(r.ms)) })));
    maybePrune(rows.length);
  } catch {
    /* the JSON log line already carries this request */
  }
}

/** Queue one row. Written within half a second, or at once when 200 are waiting. */
export function recordRequest(row: RequestRow) {
  if (!dbConfigured()) return;
  buffer.push(row);
  if (buffer.length >= 200) {
    if (timer) clearTimeout(timer);
    timer = null;
    flushing = flush();
    return;
  }
  timer ??= setTimeout(() => {
    timer = null;
    flushing = flush();
  }, 500);
}

/** Write what is waiting now (tests, and the worker before it exits). */
export async function flushRequestLog() {
  if (timer) clearTimeout(timer);
  timer = null;
  await flushing;
  await flush();
}
