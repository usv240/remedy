/**
 * What each job kind does. verify_claim runs the six checks on an open claim; pay_claim sends an approved payment.
 * Both are safe to run again: a decided claim is returned as it is, and the payments engine never pays a claim
 * twice. Handlers get the job row (for the attempt count) and a `progress` sink for the stage events the owner's page
 * streams. Server only; the worker (scripts/worker.ts) and the inline fallback (index.ts) both call runClaimed.
 */
import { eq } from "drizzle-orm";
import { checkClaim, type CheckOptions } from "@/app/api/claims/_lib/claims";
import type { ClaimEvent } from "@/app/api/claims/_lib/types";
import { db, schema } from "../db";
import { log } from "../log";
import { payClaim } from "../payments";
import { addProgress, failJob, finishJob, MAX_ATTEMPTS, type JobKind, type JobRow } from "./queue";

export type Handler = (job: JobRow, progress: (e: unknown) => Promise<void>) => Promise<unknown>;

export type VerifyClaimPayload = { claimId: string; options: CheckOptions };
export type PayClaimPayload = { claimId: string };
export type PayClaimResult = { kind: string; plain: string; status: string | null };

export const HANDLERS: Record<JobKind, Handler> = {
  async verify_claim(job, progress) {
    const p = job.payload as unknown as VerifyClaimPayload;
    let chain = Promise.resolve();
    const emit = (e: ClaimEvent) => {
      if (e.type === "result") return; // the route reads the claim itself once the job is done
      chain = chain.then(() => progress(e)).catch(() => {});
    };
    const view = await checkClaim(p.claimId, p.options, emit, { final: job.attempts >= MAX_ATTEMPTS });
    await chain;
    return { claimId: view.id, decision: view.decision };
  },

  async pay_claim(job) {
    const p = job.payload as unknown as PayClaimPayload;
    const r = await payClaim(p.claimId);
    const s = r.kind === "sent" || r.kind === "already" ? (r.payment?.status === "paid" ? "paid" : r.payment?.status === "unclaimed" ? "unclaimed" : "approved") : null;
    if (s) await db().update(schema.claims).set({ status: s, updatedAt: new Date() }).where(eq(schema.claims.id, p.claimId));
    log.info("payment job finished", { claim_id: p.claimId, kind: r.kind, batch_id: "payment" in r && r.payment ? r.payment.payoutBatchId : null });
    if (r.kind === "retry_later") throw new Error(r.plain); // PayPal asked for a retry: the job's backoff handles it
    const out: PayClaimResult = { kind: r.kind, plain: r.plain, status: s };
    return out;
  },
};

export const JOB_KINDS = Object.keys(HANDLERS) as JobKind[];

/** Run a job this process has already claimed (status running), then mark it done or record the failure. */
export async function runClaimed(job: JobRow): Promise<"done" | "queued" | "failed"> {
  const started = Date.now();
  const handler = (HANDLERS as Partial<Record<string, Handler>>)[job.kind];
  try {
    if (!handler) throw new Error(`Unknown job kind: ${job.kind}`);
    const result = await handler(job, (e) => addProgress(job.id, e));
    await finishJob(job.id, result);
    log.info("job done", { job_id: job.id, kind: job.kind, attempt: job.attempts, ms: Date.now() - started });
    return "done";
  } catch (e) {
    const status = await failJob(job.id, e, job.attempts, { maxAttempts: handler ? MAX_ATTEMPTS : 1 });
    const final = status === "failed";
    log[final ? "error" : "warn"](final ? "job failed for good" : "job failed; will retry", { job_id: job.id, kind: job.kind, attempt: job.attempts, ms: Date.now() - started, error: e });
    return final ? "failed" : "queued";
  }
}
