// The job worker: takes verify_claim and pay_claim jobs off the `job` table and runs them (src/lib/jobs), so the
// six checks and the payouts run off the request path. Polls every 500 ms with "for update skip locked", so several
// workers share the queue; retries with exponential backoff up to 5 attempts; writes a heartbeat row every 30 s that
// /status and /ops show as "worker last seen". On Render this is the remedy-worker service (render.yaml); locally:
//   npm run worker            (tsx --env-file=.env.local scripts/worker.ts)
import os from "node:os";
import { JOB_KINDS, runClaimed } from "../src/lib/jobs/handlers";
import { claimNext, heartbeat } from "../src/lib/jobs/queue";
import { log } from "../src/lib/log";
import { flushRequestLog } from "../src/lib/ops/request-log";

const NAME = `${os.hostname()}:${process.pid}`;
const POLL_MS = 500;
const HEARTBEAT_MS = 30_000;
/** Jobs this process runs at once (WORKER_CONCURRENCY); a photo check is mostly waiting on the model or the database. */
const LANES = Math.max(1, Math.min(16, Number(process.env.WORKER_CONCURRENCY) || 4));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!process.env.DATABASE_URL) {
  process.stderr.write("worker: DATABASE_URL is not set.\n");
  process.exit(1);
}

let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info("worker stopping", { worker: NAME, signal });
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

async function beat() {
  try {
    await heartbeat(NAME);
  } catch (e) {
    log.warn("worker heartbeat failed", { error: e });
  }
}

/** One lane: take the next due job, run it, repeat; sleep when the queue is empty. */
async function lane(n: number) {
  while (!stopping) {
    let job = null;
    try {
      job = await claimNext(JOB_KINDS, `${NAME}#${n}`);
    } catch (e) {
      log.error("worker could not read the queue", { lane: n, error: e });
      await sleep(5000);
      continue;
    }
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    log.info("job taken", { job_id: job.id, kind: job.kind, attempt: job.attempts, lane: n });
    await runClaimed(job);
  }
}

async function main() {
  log.info("worker started", { worker: NAME, kinds: JOB_KINDS, poll_ms: POLL_MS, lanes: LANES });
  await beat();
  const hb = setInterval(() => void beat(), HEARTBEAT_MS);
  await Promise.all(Array.from({ length: LANES }, (_, i) => lane(i + 1)));
  clearInterval(hb);
  await flushRequestLog();
  log.info("worker stopped", { worker: NAME });
  process.exit(0);
}

main().catch((e) => {
  log.error("worker crashed", { error: e });
  process.exit(1);
});
