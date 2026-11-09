import { afterAll, afterEach, describe, expect, it } from "vitest";
import { allowPicture, allowUpload, clientKey, hit, peek, resetMemoryLimits } from "@/lib/ratelimit";

/**
 * The fixed-window limiter. Without DATABASE_URL (npm test) the counts live in memory for this process; with it, the
 * same calls upsert the rate_limit table, so the suite checks the one code path in both stores. Buckets carry a run
 * tag, and every row the run made is removed at the end.
 */
const enabled = Boolean(process.env.DATABASE_URL);
const tag = `test-${Date.now().toString(36)}`;
const IP = "198.51.100.1";
const IP2 = "192.0.2.77";
const IP3 = "192.0.2.78";

describe("rate limit windows", () => {
  afterEach(() => resetMemoryLimits());
  afterAll(async () => {
    if (!enabled) return;
    const { db } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    await db().execute(sql`delete from rate_limit where bucket like ${`${tag}%`} or bucket like ${`%:${clientKey(IP)}`} or bucket like ${`%:${clientKey(IP2)}`} or bucket like ${`%:${clientKey(IP3)}`}`);
  });

  it("counts hits in a fixed window and says when to retry", async () => {
    const t0 = Date.now();
    for (let i = 1; i <= 3; i++) expect(await hit(`${tag}:a`, 3, 60_000, t0 + i)).toEqual({ ok: true, count: i, remaining: 3 - i });
    const fourth = await hit(`${tag}:a`, 3, 60_000, t0 + 10);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect((await hit(`${tag}:b`, 3, 60_000, t0)).ok).toBe(true); // another bucket
    expect((await hit(`${tag}:a`, 3, 60_000, t0 + 60_000)).ok).toBe(true); // the next window
    expect(await peek(`${tag}:a`, 60_000, t0)).toBe(4);
  });

  it("hashes the client address, never keeping it raw", () => {
    const k = clientKey("203.0.113.9", "salt");
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(k).not.toContain("203");
    expect(clientKey("203.0.113.9", "salt")).toBe(k);
    expect(clientKey("203.0.113.9", "other")).not.toBe(k);
  });

  it("keeps the picture route's 120-a-minute limit", { timeout: 60_000 }, async () => {
    const t0 = Date.now() + 3_600_000;
    for (let i = 0; i < 120; i++) expect((await allowPicture(IP, 120, t0 + i)).ok).toBe(true);
    expect((await allowPicture(IP, 120, t0 + 500)).ok).toBe(false);
  });

  it("applies the upload limits with the same messages", async () => {
    const t0 = Date.now() + 7_200_000;
    for (let i = 0; i < 6; i++) expect((await allowUpload(IP2, t0 + i)).ok).toBe(true);
    const seventh = await allowUpload(IP2, t0 + 10);
    expect(seventh.ok).toBe(false);
    if (!seventh.ok) expect(seventh.plain).toBe("That is a lot of photos in a few minutes. Please wait a little, or try one of our sample photos.");
    expect((await allowUpload("198.51.100.7", t0 + 10)).ok).toBe(true);
    expect((await allowUpload(IP2, t0 + 11 * 60_000)).ok).toBe(true);
  });

  it("caps a visitor at 30 a day", async () => {
    const t0 = Date.now() + 10_800_000;
    const limits = { perWindow: 100, windowMs: 1000, perDay: 30, dayMs: 86_400_000 };
    for (let i = 0; i < 30; i++) expect((await allowUpload(IP3, t0 + i * 2000, limits)).ok).toBe(true);
    const over = await allowUpload(IP3, t0 + 70_000, limits);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.plain).toContain("come back tomorrow");
  });
});

describe.skipIf(!enabled)("rate limit windows in Postgres", async () => {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  afterAll(async () => {
    await db().execute(sql`delete from rate_limit where bucket like ${`${tag}%`}`);
  });

  it("upserts one row per window and returns the count", async () => {
    const now = Date.now();
    const bucket = `${tag}:pg`;
    expect(await hit(bucket, 2, 60_000, now)).toEqual({ ok: true, count: 1, remaining: 1 });
    expect(await hit(bucket, 2, 60_000, now + 1)).toEqual({ ok: true, count: 2, remaining: 0 });
    expect((await hit(bucket, 2, 60_000, now + 2)).ok).toBe(false);
    const rows = (await db().execute(sql`select count from rate_limit where bucket = ${bucket}`)).rows as { count: number }[];
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].count)).toBe(3);
  });

  it("holds across callers: ten hits at once count ten", async () => {
    const now = Date.now() + 120_000;
    await Promise.all(Array.from({ length: 10 }, () => hit(`${tag}:par`, 100, 60_000, now)));
    expect(await peek(`${tag}:par`, 60_000, now)).toBe(10);
  });
});
