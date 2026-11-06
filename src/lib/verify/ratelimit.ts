import { createHash } from "node:crypto";

/**
 * Per-visitor limits on /try photo uploads, so a busy day on the public demo cannot spend the AI budget on one visitor.
 * Kept in memory for the one web process Render runs; keyed by a salted hash of the IP, never the IP itself.
 * Presets do not count: their answers are precomputed and cost nothing.
 */

export const TRY_LIMITS = { perWindow: 6, windowMs: 10 * 60_000, perDay: 30, dayMs: 24 * 60 * 60_000 } as const;

const hits = new Map<string, number[]>();
const MAX_VISITORS = 10_000;

export const visitorKey = (ip: string, salt = process.env.CHECKS_SECRET ?? "remedy") => createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);

export type TryLimit = { ok: true; remaining: number } | { ok: false; retryAfterSec: number; plain: string };

/** Count one upload for this visitor, or say when they can try again. */
export function allowTryUpload(ip: string, now = Date.now(), limits: { perWindow: number; windowMs: number; perDay: number; dayMs: number } = TRY_LIMITS): TryLimit {
  const key = visitorKey(ip);
  const list = (hits.get(key) ?? []).filter((t) => now - t < limits.dayMs);
  const inWindow = list.filter((t) => now - t < limits.windowMs);
  if (list.length >= limits.perDay) {
    return { ok: false, retryAfterSec: Math.ceil((list[0] + limits.dayMs - now) / 1000), plain: "You have tried a lot of photos today. Please come back tomorrow, or try one of our sample photos." };
  }
  if (inWindow.length >= limits.perWindow) {
    return { ok: false, retryAfterSec: Math.ceil((inWindow[0] + limits.windowMs - now) / 1000), plain: "That is a lot of photos in a few minutes. Please wait a little, or try one of our sample photos." };
  }
  list.push(now);
  if (!hits.has(key) && hits.size >= MAX_VISITORS) hits.delete(hits.keys().next().value as string);
  hits.set(key, list);
  return { ok: true, remaining: Math.min(limits.perWindow - inWindow.length - 1, limits.perDay - list.length) };
}

/** For tests. */
export function resetTryLimits() {
  hits.clear();
}
