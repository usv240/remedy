import { afterAll, describe, expect, it } from "vitest";
import { backoffMs, MAX_ATTEMPTS } from "@/lib/jobs/queue";

describe("job backoff", () => {
  it("doubles from one second and caps at a minute", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(20)).toBe(60_000);
    expect(MAX_ATTEMPTS).toBe(5);
  });
});

const enabled = Boolean(process.env.DATABASE_URL);

/** The queue against the real `remedy` database (skipped without DATABASE_URL); every row it makes is removed. */
describe.skipIf(!enabled)("the job queue in Postgres", async () => {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { addProgress, claimJob, claimNext, enqueue, failJob, finishJob, getJob, heartbeat, queueStats, retryJob, workerAlive } = await import("@/lib/jobs/queue");
  const { waitForJob } = await import("@/lib/jobs");
  const tag = `jobtest-${Date.now().toString(36)}`;
  const made: number[] = [];
  // Kinds of its own, so a worker running against the same database (npm run worker) never takes these rows.
  type Kind = Parameters<typeof enqueue>[0];
  const A = `${tag}-a` as Kind;
  const B = `${tag}-b` as Kind;
  const add = async (kind: Kind, payload: Record<string, unknown> = {}, runAfter?: Date) => {
    const id = await enqueue(kind, { tag, ...payload }, { runAfter });
    made.push(id);
    return id;
  };
  afterAll(async () => {
    if (made.length) await db().execute(sql`delete from job where id in ${made}`);
    await db().execute(sql`delete from integration_status where id = 'worker' and detail like 'test-%'`);
  });

  it("takes queued jobs in order with skip locked, so two workers never run the same job", async () => {
    const a = await add(A, { n: 1 });
    const b = await add(A, { n: 2 });
    const [x, y] = await Promise.all([claimNext([A], "w1"), claimNext([A], "w2")]);
    const ids = [x?.id, y?.id].sort();
    expect(ids).toEqual([a, b].sort());
    expect(x?.status).toBe("running");
    expect(x?.attempts).toBe(1);
    await finishJob(a, { ok: true });
    await finishJob(b, { ok: true });
    expect((await getJob(a))?.status).toBe("done");
    expect((await getJob(a))?.result).toEqual({ ok: true });
  });

  it("leaves a job not yet due alone", async () => {
    const later = await add(A, { later: true }, new Date(Date.now() + 3_600_000));
    expect(await claimNext([A], "w1")).toBeNull();
    expect((await getJob(later))?.status).toBe("queued");
  });

  it("retries with backoff and dead-letters after the fifth attempt, keeping the error", async () => {
    const id = await add(B, { boom: true });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const got = await claimJob(id, "w1");
      expect(got?.attempts).toBe(attempt);
      const status = await failJob(id, new Error(`try ${attempt} failed`), attempt, { now: new Date(0) });
      const row = (await getJob(id))!;
      if (attempt < MAX_ATTEMPTS) {
        expect(status).toBe("queued");
        expect(row.status).toBe("queued");
        expect(row.runAfter.getTime()).toBe(backoffMs(attempt));
      } else {
        expect(status).toBe("failed");
        expect(row.status).toBe("failed");
        expect(row.lastError).toBe("try 5 failed");
      }
    }
    expect(await claimJob(id, "w1")).toBeNull(); // a dead letter is never taken again
    const stats = await queueStats();
    expect(stats.failed).toBeGreaterThanOrEqual(1);
    await retryJob(id);
    expect((await getJob(id))?.status).toBe("queued");
    expect((await getJob(id))?.attempts).toBe(0);
    await finishJob(id);
  });

  it("records progress events in order and streams them to a waiter", async () => {
    const id = await add(B, { progress: true });
    const got = await claimJob(id, "w1");
    expect(got).not.toBeNull();
    const seen: unknown[] = [];
    const waiter = waitForJob(id, { onProgress: (e) => seen.push(e), inlineAfterMs: 0, timeoutMs: 10_000 });
    await addProgress(id, { type: "stage", stage: "vision", state: "start" });
    await addProgress(id, { type: "stage", stage: "vision", state: "done" });
    await finishJob(id, { done: true });
    const row = await waiter;
    expect(row?.status).toBe("done");
    expect(seen).toEqual([
      { type: "stage", stage: "vision", state: "start" },
      { type: "stage", stage: "vision", state: "done" },
    ]);
  });

  it("writes the worker heartbeat that /status reads", async () => {
    await heartbeat("test-worker");
    expect(await workerAlive()).toBe(true);
    const s = await queueStats();
    expect(s.workerSeenAt && Date.now() - s.workerSeenAt.getTime()).toBeLessThan(60_000);
  });
});
