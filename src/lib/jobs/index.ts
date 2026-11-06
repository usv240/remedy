/**
 * The job queue, as routes use it: enqueue a job and wait for it, streaming its progress events, with the inline
 * fallback when no worker takes the job within 2 seconds (local development without `npm run worker`), so nothing
 * hangs. Server only.
 */
import { log } from "../log";
import { runClaimed } from "./handlers";
import { claimJob, enqueue, getJob, workerAlive, type JobKind, type JobRow } from "./queue";

export { enqueue, getJob, queueStats, recentJobs, retryJob, workerAlive } from "./queue";
export type { JobKind, JobRow, JobStatus, QueueStats } from "./queue";

export const INLINE_AFTER_MS = 2000;
/** With a live worker, a job still queued after this long is run inline anyway (the worker may be stuck). */
export const INLINE_DESPITE_WORKER_MS = 60_000;
const POLL_MS = 500;

export type WaitOptions = {
  /** Called with each new progress event as it appears. */
  onProgress?: (e: unknown) => void;
  /** Give up waiting after this long (the job keeps running). Default 4 minutes. */
  timeoutMs?: number;
  /** Run the job in this process if no worker took it within this long. Default 2 s; 0 never. */
  inlineAfterMs?: number;
  signal?: AbortSignal;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a job to finish, polling every 500 ms, handing `onProgress` each new event. Resolves with the final row
 * (status done or failed), or null when the wait timed out or was aborted.
 */
export async function waitForJob(id: number, o: WaitOptions = {}): Promise<JobRow | null> {
  const started = Date.now();
  const timeout = o.timeoutMs ?? 240_000;
  const inlineAfter = o.inlineAfterMs ?? INLINE_AFTER_MS;
  let seen = 0;
  let triedInline = false;
  for (;;) {
    if (o.signal?.aborted) return null;
    const job = await getJob(id);
    if (!job) return null;
    for (const e of job.progress.slice(seen)) o.onProgress?.(e);
    seen = job.progress.length;
    if (job.status === "done" || job.status === "failed") return job;
    const waited = Date.now() - started;
    if (job.status === "queued" && !triedInline && inlineAfter > 0 && waited >= inlineAfter) {
      // No worker reporting in: run it here so nothing hangs. With a live worker, keep waiting: it is draining the
      // queue, and a hundred routes each running their own job would only slow the web process down.
      const alive = await workerAlive();
      if (!alive || waited >= INLINE_DESPITE_WORKER_MS) {
        triedInline = true;
        const claimed = await claimJob(id, `inline:${process.pid}`);
        if (claimed) {
          log.warn(alive ? "job ran inline: the worker did not take it in time" : "job ran inline: no worker running", { job_id: id, kind: job.kind, waited_ms: waited });
          await runClaimed(claimed);
          continue;
        }
      }
    }
    if (Date.now() - started > timeout) return null;
    await sleep(POLL_MS);
  }
}

/** Enqueue and wait, in one call. */
export async function runJob(kind: JobKind, payload: Record<string, unknown>, o: WaitOptions = {}): Promise<JobRow | null> {
  const id = await enqueue(kind, payload);
  return waitForJob(id, o);
}
