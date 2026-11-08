/**
 * The job queue, as routes use it: enqueue a job and wait for it, streaming its progress events. With no worker
 * reporting in (local development without `npm run worker`, or a deployment whose worker is down), the route runs the
 * job itself at once, so nothing hangs and nothing waits for a worker that is not there. Server only.
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
  /** 0: never run the job in this process. Any other value: run it here when no worker is alive. */
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
    if (job.status === "queued" && !triedInline && inlineAfter > 0) {
      // No worker reporting in (its heartbeat is older than WORKER_STALE_MS): run it here at once, since no one else
      // will take it. With a live worker, keep waiting (up to INLINE_DESPITE_WORKER_MS): it is draining the queue, and a
      // hundred routes each running their own job would only slow the web process down. Measured on 2026-11-08 with
      // no worker, waiting the 2 s first was 2.3 of the 2.5 s a lone no-AI claim took (content/public/load-test.json).
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
