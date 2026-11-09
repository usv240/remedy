/**
 * Rate limits that hold across instances and deploys: one Postgres table, rate_limit (bucket, window_start, count),
 * and one upsert that returns the new count. Each limit is a fixed window; a bucket is "<limit>:<hashed client>",
 * so no raw address is stored. Without a database (tests, a bare local run) the same limits are counted in memory
 * for this process. Rows older than a day are pruned from this code path (src/lib/ops/prune.ts). Server only.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, dbConfigured } from "./db";
import { log } from "./log";
import { maybePrune } from "./ops/prune";

export type Window = { ok: true; count: number; remaining: number } | { ok: false; count: number; retryAfterSec: number };

/** A client's address, hashed with the server secret so no raw address is kept anywhere. */
export const clientKey = (ip: string, salt = process.env.AUDIT_SALT ?? process.env.CHECKS_SECRET ?? "remedy") => createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);

/**
 * Where the caller's address is read from, most trusted first. The hosted site sits behind Cloudflare and Render's
 * proxy, which set cf-connecting-ip (and true-client-ip) to the address that reached them; a caller can put any value
 * at the left of X-Forwarded-For, so that header is read only when neither is there (a local run, or a test that sets
 * it). Every per-client limit reads the address here, through clientIp.
 */
export const CLIENT_ADDRESS_HEADERS = ["cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip"] as const;
export type ClientAddressSource = (typeof CLIENT_ADDRESS_HEADERS)[number] | "none";

/** The caller's address and the header it came from ("none" when no header names one). */
export function clientAddress(req: Request): { ip: string; from: ClientAddressSource } {
  for (const h of ["cf-connecting-ip", "true-client-ip"] as const) {
    const v = req.headers.get(h)?.trim();
    if (v) return { ip: v, from: h };
  }
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return { ip: forwarded, from: "x-forwarded-for" };
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return { ip: real, from: "x-real-ip" };
  return { ip: "local", from: "none" };
}

/** The caller's address, for per-client limits and hashed keys. */
export const clientIp = (req: Request) => clientAddress(req).ip;

/** For /api/health: the header this request's client address came from. Only the header's name, never the address. */
export function addressSource(req: Request) {
  const from = clientAddress(req).from;
  return { client_address_from: from, note: `client address from: ${from === "none" ? "no proxy header (a direct request)" : from}` };
}

const memory = new Map<string, number>();
const MEMORY_MAX = 20_000;

function memoryHit(bucket: string, windowStart: number): number {
  const key = `${bucket}@${windowStart}`;
  const n = (memory.get(key) ?? 0) + 1;
  if (!memory.has(key) && memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value as string);
  memory.set(key, n);
  return n;
}

/**
 * Count one hit in `bucket` for the fixed window of `windowMs` that holds `now`, and say whether the caller is still
 * under `limit`. One statement: insert the window row, or add one to it, and return the count.
 */
export async function hit(bucket: string, limit: number, windowMs: number, now = Date.now()): Promise<Window> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  let count: number;
  if (dbConfigured()) {
    try {
      const r = await db().execute(
        sql`insert into rate_limit (bucket, window_start, count) values (${bucket}, ${new Date(windowStart)}, 1)
            on conflict (bucket, window_start) do update set count = rate_limit.count + 1 returning count`,
      );
      count = Number((r.rows[0] as { count: number }).count);
      maybePrune();
    } catch (e) {
      // A limit that cannot be counted still counts in this process, so the site never opens wide on a database blip.
      log.warn("rate_limit: database upsert failed; counting in memory", { bucket: bucket.split(":")[0], error: e });
      count = memoryHit(bucket, windowStart);
    }
  } else {
    count = memoryHit(bucket, windowStart);
  }
  return count > limit ? { ok: false, count, retryAfterSec } : { ok: true, count, remaining: limit - count };
}

/** Look without counting: the current count in the window. */
export async function peek(bucket: string, windowMs: number, now = Date.now()): Promise<number> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  if (!dbConfigured()) return memory.get(`${bucket}@${windowStart}`) ?? 0;
  try {
    const r = await db().execute(sql`select count from rate_limit where bucket = ${bucket} and window_start = ${new Date(windowStart)}`);
    return Number((r.rows[0] as { count?: number } | undefined)?.count ?? 0);
  } catch {
    return memory.get(`${bucket}@${windowStart}`) ?? 0;
  }
}

/** For tests: forget this process's in-memory counts. */
export function resetMemoryLimits() {
  memory.clear();
}

// ---------------------------------------------------------------------------------------------------------------
// The limits Remedy applies, each with the threshold and message it has always had
// ---------------------------------------------------------------------------------------------------------------

/** Per-visitor photo uploads (plan: 6 in 10 minutes, 30 a day), on top of the API's per-minute limit. */
export const TRY_LIMITS = { perWindow: 6, windowMs: 10 * 60_000, perDay: 30, dayMs: 24 * 60 * 60_000 } as const;

export type TryLimit = { ok: true; remaining: number } | { ok: false; retryAfterSec: number; plain: string };

/** Count one photo upload for a visitor, or say when to try again. The daily window is checked first, then the short one. */
export async function allowUpload(ip: string, now = Date.now(), limits: { perWindow: number; windowMs: number; perDay: number; dayMs: number } = TRY_LIMITS): Promise<TryLimit> {
  const key = clientKey(ip);
  const day = await hit(`upload-day:${key}`, limits.perDay, limits.dayMs, now);
  if (!day.ok) return { ok: false, retryAfterSec: day.retryAfterSec, plain: "You have tried a lot of photos today. Please come back tomorrow, or try one of our sample photos." };
  const short = await hit(`upload:${key}`, limits.perWindow, limits.windowMs, now);
  if (!short.ok) return { ok: false, retryAfterSec: short.retryAfterSec, plain: "That is a lot of photos in a few minutes. Please wait a little, or try one of our sample photos." };
  return { ok: true, remaining: Math.min(short.remaining, day.remaining) };
}

/** A light per-visitor limit on the routes that serve pictures: 120 a minute. */
export async function allowPicture(ip: string, perMinute = 120, now = Date.now()): Promise<Window> {
  return hit(`picture:${clientKey(ip)}`, perMinute, 60_000, now);
}
