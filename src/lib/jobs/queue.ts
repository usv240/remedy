/**
 * The job queue, on the `job` table: verification (verify_claim) and payouts (pay_claim) run off the request path.
 *
 * - enqueue() adds a queued row; a worker (scripts/worker.ts) takes the next one with "for update skip locked", so
 *   several workers never run the same job;
 * - a handler that throws is retried with exponential backoff (1, 2, 4, 8 s) up to MAX_ATTEMPTS; after that the row
 *   stays `failed` with its error: the dead letter, shown on /status and /ops;
 * - progress holds the stage events the owner's page streams; result holds what the handler answered;
 * - the worker writes a heartbeat row (integration_status id "worker") every 30 s, so a route can tell whether a
 *   worker is running and otherwise run the job inline after 2 s (src/lib/jobs/index.ts).
 * Server only. Everything here is plain SQL on one table; the handlers live in handlers.ts.
 */
import { sql } from "drizzle-orm";
import { db, dbConfigured, schema } from "../db";
import { log } from "../log";

export type JobKind = "verify_claim" | "pay_claim";
export type JobStatus = "queued" | "running" | "done" | "failed";

export type JobRow = {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  runAfter: Date;
  lastError: string | null;
  progress: unknown[];
  result: unknown;
  worker: string | null;
  created: Date;
  updated: Date;
};

export const MAX_ATTEMPTS = 5;
/** Seconds to wait before attempt n+1 after attempt n failed: 1, 2, 4, 8 (the fifth failure is final). */
export const backoffMs = (attempt: number) => Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
/** A worker heartbeat older than this means no worker is running. */
export const WORKER_STALE_MS = 90_000;
export const HEARTBEAT_ID = "worker";

type Raw = {
  id: string | number;
  kind: string;
  payload: unknown;
  status: string;
  attempts: number;
  run_after: Date;
  last_error: string | null;
  progress: unknown;
  result: unknown;
  worker: string | null;
  created: Date;
  updated: Date;
};

const toRow = (r: Raw): JobRow => ({
  id: Number(r.id),
  kind: r.kind as JobKind,
  payload: (r.payload ?? {}) as Record<string, unknown>,
  status: r.status as JobStatus,
  attempts: r.attempts,
  runAfter: new Date(r.run_after),
  lastError: r.last_error,
  progress: Array.isArray(r.progress) ? r.progress : [],
  result: r.result,
  worker: r.worker,
  created: new Date(r.created),
  updated: new Date(r.updated),
});

/** Add a job. Returns its id. */
export async function enqueue(kind: JobKind, payload: Record<string, unknown>, opts: { runAfter?: Date } = {}): Promise<number> {
  // run_after defaults to the database's clock, so a job is due at once whatever this machine's clock says.
  const [row] = await db()
    .insert(schema.jobs)
    .values({ kind, payload, ...(opts.runAfter ? { runAfter: opts.runAfter } : {}) })
    .returning({ id: schema.jobs.id });
  log.info("job queued", { job_id: row.id, kind });
  return row.id;
}

export async function getJob(id: number): Promise<JobRow | null> {
  const r = await db().execute(sql`select * from job where id = ${id}`);
  return r.rows[0] ? toRow(r.rows[0] as Raw) : null;
}

/**
 * Take the next queued job that is due, marking it running in the same statement. Rows another worker holds are
 * skipped (skip locked), so two workers never run the same job. Null when nothing is due.
 */
export async function claimNext(kinds: JobKind[], worker: string): Promise<JobRow | null> {
  if (!kinds.length) return null;
  const r = await db().execute(sql`
    update job set status = 'running', attempts = attempts + 1, worker = ${worker}, updated = now()
    where id = (
      select id from job where status = 'queued' and run_after <= now() and kind in ${kinds}
      order by id for update skip locked limit 1
    )
    returning *`);
  return r.rows[0] ? toRow(r.rows[0] as Raw) : null;
}

/** Take one specific job if it is still queued (the inline fallback when no worker is running). */
export async function claimJob(id: number, worker: string): Promise<JobRow | null> {
  const r = await db().execute(sql`
    update job set status = 'running', attempts = attempts + 1, worker = ${worker}, updated = now()
    where id = ${id} and status = 'queued' returning *`);
  return r.rows[0] ? toRow(r.rows[0] as Raw) : null;
}

export async function finishJob(id: number, result: unknown = null) {
  await db().execute(sql`update job set status = 'done', result = ${JSON.stringify(result ?? null)}::jsonb, last_error = null, updated = now() where id = ${id}`);
}

/**
 * Record a failed attempt: back to the queue with backoff while attempts remain, else the dead letter (`failed`).
 * Returns the status the row now has.
 */
export async function failJob(id: number, error: unknown, attempts: number, opts: { maxAttempts?: number; now?: Date } = {}): Promise<"queued" | "failed"> {
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const final = attempts >= max;
  // The backoff counts from the database's clock (a test can pin it with opts.now).
  const runAfter = opts.now ? sql`${new Date(opts.now.getTime() + backoffMs(attempts))}` : sql`now() + ${backoffMs(attempts)} * interval '1 millisecond'`;
  await db().execute(
    final
      ? sql`update job set status = 'failed', last_error = ${message}, updated = now() where id = ${id}`
      : sql`update job set status = 'queued', last_error = ${message}, run_after = ${runAfter}, updated = now() where id = ${id}`,
  );
  return final ? "failed" : "queued";
}

/** Append one progress event (a stage the owner's page shows). */
export async function addProgress(id: number, event: unknown) {
  await db().execute(sql`update job set progress = progress || ${JSON.stringify([event])}::jsonb, updated = now() where id = ${id}`);
}

/** Put a failed job back on the queue (a person retrying from the console). */
export async function retryJob(id: number) {
  await db().execute(sql`update job set status = 'queued', attempts = 0, run_after = now(), updated = now() where id = ${id} and status = 'failed'`);
}

export type QueueStats = { queued: number; running: number; failed: number; doneToday: number; oldestWaitingSec: number | null; workerSeenAt: Date | null; workerName: string | null };

/** Queue depth, the oldest waiting job, the dead letters, and when a worker last reported in. */
export async function queueStats(): Promise<QueueStats> {
  if (!dbConfigured()) return { queued: 0, running: 0, failed: 0, doneToday: 0, oldestWaitingSec: null, workerSeenAt: null, workerName: null };
  const [counts, hb] = await Promise.all([
    db().execute(sql`
      select
        count(*) filter (where status = 'queued')::int as queued,
        count(*) filter (where status = 'running')::int as running,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'done' and updated > now() - interval '1 day')::int as done_today,
        extract(epoch from (now() - min(created) filter (where status in ('queued', 'running'))))::int as oldest_sec
      from job`),
    db().execute(sql`select last_ok_at, detail from integration_status where id = ${HEARTBEAT_ID}`),
  ]);
  const c = counts.rows[0] as { queued: number; running: number; failed: number; done_today: number; oldest_sec: number | null };
  const h = hb.rows[0] as { last_ok_at: Date | null; detail: string } | undefined;
  return {
    queued: c.queued,
    running: c.running,
    failed: c.failed,
    doneToday: c.done_today,
    oldestWaitingSec: c.oldest_sec ?? null,
    workerSeenAt: h?.last_ok_at ? new Date(h.last_ok_at) : null,
    workerName: h?.detail ?? null,
  };
}

/** The worker's heartbeat row, written every 30 s while it runs. */
export async function heartbeat(worker: string) {
  await db().execute(sql`
    insert into integration_status (id, mode, detail, last_ok_at, updated_at) values (${HEARTBEAT_ID}, 'live', ${worker}, now(), now())
    on conflict (id) do update set mode = 'live', detail = excluded.detail, last_ok_at = now(), updated_at = now()`);
}

let aliveCache: { at: number; value: boolean } | null = null;

/** True when a worker reported in within WORKER_STALE_MS. Cached for 2 s, since every waiting route asks. */
export async function workerAlive(now = Date.now()): Promise<boolean> {
  if (!dbConfigured()) return false;
  if (aliveCache && now - aliveCache.at < 2000) return aliveCache.value;
  try {
    const r = await db().execute(sql`select last_ok_at from integration_status where id = ${HEARTBEAT_ID}`);
    const at = (r.rows[0] as { last_ok_at: Date | null } | undefined)?.last_ok_at;
    const value = Boolean(at && now - new Date(at).getTime() < WORKER_STALE_MS);
    aliveCache = { at: now, value };
    return value;
  } catch {
    return false;
  }
}

/** The last jobs, newest first, for /ops (ids and kinds only; payloads hold claim ids, nothing personal). */
export async function recentJobs(limit = 20): Promise<Pick<JobRow, "id" | "kind" | "status" | "attempts" | "lastError" | "created" | "updated">[]> {
  const r = await db().execute(sql`select id, kind, status, attempts, last_error, created, updated from job order by id desc limit ${limit}`);
  return (r.rows as Raw[]).map((x) => ({ id: Number(x.id), kind: x.kind as JobKind, status: x.status as JobStatus, attempts: x.attempts, lastError: x.last_error, created: new Date(x.created), updated: new Date(x.updated) }));
}
