import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, dbConfigured, schema } from "../db";
import { withRequest } from "../log";
import { hit } from "../ratelimit";
import { fail } from "./envelope";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const KEY_PREFIX = "rm_test_";
export const LIMITS = { keyPerMinute: 60, keyPerDay: 1000, demoPerMinute: 20 } as const;

/** rm_test_ followed by 32 random bytes in base62 (43 characters). */
export function newKey() {
  let out = "";
  while (out.length < 43) {
    for (const b of randomBytes(64)) if (b < 248 && out.length < 43) out += B62[b % 62];
  }
  return KEY_PREFIX + out;
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
export const displayPrefix = (key: string) => key.slice(0, 12);

/** The caller's IP, hashed with a server secret so the request log never stores raw addresses. */
export function clientId(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256")
    .update(`${process.env.AUDIT_SALT ?? "remedy"}:${ip}`)
    .digest("hex")
    .slice(0, 24);
}

function bearer(req: Request) {
  const h = req.headers.get("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return req.headers.get("x-api-key")?.trim() || null;
}

function withHeaders(res: Response, headers: Record<string, string>) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/**
 * Every public API call goes through here. A key is optional: without one, calls use the demo tier
 * (20 a minute per client), which is what this site's own pages use. With a key: 60 a minute and
 * 1,000 a day, and the call shows up on the key's usage page.
 *
 * The per-minute and per-day counts live in the rate_limit table (src/lib/ratelimit.ts), so they hold across
 * instances and deploys; api_usage remains the record of each call for the key's usage page. Every call runs inside
 * a request context (src/lib/log.ts): one log line and one request_log row with the route, status and duration.
 */
export async function guard(req: Request, endpoint: string, handler: () => Promise<Response>) {
  return withRequest(req, endpoint, async () => {
    if (!dbConfigured()) return handler();
    const started = Date.now();
    const token = bearer(req);
    const client = clientId(req);
    let keyId: number | null = null;
    let limit: number = LIMITS.demoPerMinute;
    let remaining: number;

    if (token) {
      const [key] = await db()
        .select()
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.hash, hashKey(token)), isNull(schema.apiKeys.revokedAt)))
        .limit(1);
      if (!key) return fail("unauthorized", "That API key is not valid or was revoked. Create a new one on the Developers page.", 401);
      keyId = key.id;
      limit = LIMITS.keyPerMinute;
      const day = await hit(`key-day:${key.id}`, LIMITS.keyPerDay, 86_400_000);
      if (!day.ok) return withHeaders(fail("rate_limited", "This key has made 1,000 requests today. The limit resets over the next 24 hours.", 429), { "Retry-After": String(Math.min(3600, day.retryAfterSec)) });
      const minute = await hit(`key-minute:${key.id}`, limit, 60_000);
      if (!minute.ok) return withHeaders(fail("rate_limited", "Too many requests this minute. Please wait a moment and try again.", 429), { "Retry-After": String(minute.retryAfterSec) });
      remaining = minute.remaining;
    } else {
      const minute = await hit(`demo-minute:${client}`, limit, 60_000);
      if (!minute.ok) {
        return withHeaders(fail("rate_limited", "Too many requests this minute. Wait a moment, or use a free API key for higher limits.", 429), { "Retry-After": String(minute.retryAfterSec) });
      }
      remaining = minute.remaining;
    }

    const res = await handler();
    const ms = Date.now() - started;
    await db().insert(schema.apiUsage).values({ keyId, client: keyId ? "" : client, endpoint, status: res.status, ms });
    if (keyId) await db().update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, keyId));
    return withHeaders(res, { "X-RateLimit-Limit": String(limit), "X-RateLimit-Remaining": String(Math.max(0, remaining)) });
  });
}

export const OWNER_COOKIE = "rm_owner";
export const newOwnerId = () => randomBytes(18).toString("base64url");

/** Create and store a key. Returns the full key: the only time it exists outside the caller's hands. */
export async function issueKey(o: { name: string; email: string; purpose: string; ownerId: string; ip: string }) {
  const key = newKey();
  const [row] = await db()
    .insert(schema.apiKeys)
    .values({ prefix: displayPrefix(key), hash: hashKey(key), name: o.name, email: o.email.toLowerCase(), purpose: o.purpose, ownerId: o.ownerId, createdIp: o.ip })
    .returning();
  return { key, row };
}

/** Resolve a key id that belongs to this browser's owner cookie. */
export async function ownedKeyId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  const ownerId = (await cookies()).get(OWNER_COOKIE)?.value;
  return Number.isInteger(id) && ownerId ? { id, ownerId } : null;
}
