import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { fail, ok } from "@/lib/api/envelope";
import { LIMITS, OWNER_COOKIE, clientId, issueKey, newOwnerId } from "@/lib/api/keys";
import { audit } from "@/lib/audit";
import { db, dbConfigured, schema } from "@/lib/db";

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(200),
  purpose: z.string().trim().max(200).optional().default(""),
  accept: z.literal(true),
});

const count = sql<number>`count(*)::int`;

/** POST /api/keys: create a free sandbox key. The full key is returned once and never stored. */
export async function POST(req: Request) {
  const started = Date.now();
  if (!dbConfigured()) return fail("upstream_unavailable", "API keys need the database, which is not connected on this server.", 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid_request", "Add your name and email, and accept the sandbox terms.", 400, parsed.error.issues);
  const ip = clientId(req);
  const since = new Date(Date.now() - 86400_000);
  const [byIp] = await db().select({ n: count }).from(schema.apiKeys).where(and(eq(schema.apiKeys.createdIp, ip), gte(schema.apiKeys.createdAt, since)));
  const [byEmail] = await db()
    .select({ n: count })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.email, parsed.data.email.toLowerCase()), gte(schema.apiKeys.createdAt, since)));
  if ((byIp?.n ?? 0) >= 5 || (byEmail?.n ?? 0) >= 3) return fail("rate_limited", "That is the limit of new keys for today. Your existing keys still work.", 429);

  const jar = await cookies();
  const ownerId = jar.get(OWNER_COOKIE)?.value ?? newOwnerId();
  const { key, row } = await issueKey({ ...parsed.data, ownerId, ip });
  jar.set(OWNER_COOKIE, ownerId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" });
  await audit("person", "developer.key.created", `key:${row.id}`, { prefix: row.prefix });
  return ok({ id: row.id, key, prefix: row.prefix, created_at: row.createdAt, limits: { per_minute: LIMITS.keyPerMinute, per_day: LIMITS.keyPerDay } }, started);
}

/** GET /api/keys: keys created in this browser, with usage. */
export async function GET() {
  const started = Date.now();
  const empty = { keys: [], requests: [], days: [] };
  if (!dbConfigured()) return ok(empty, started);
  const ownerId = (await cookies()).get(OWNER_COOKIE)?.value;
  if (!ownerId) return ok(empty, started);
  const keys = await db().select().from(schema.apiKeys).where(eq(schema.apiKeys.ownerId, ownerId)).orderBy(desc(schema.apiKeys.createdAt));
  const ids = keys.map((k) => k.id);
  if (ids.length === 0) return ok(empty, started);
  const mine = inArray(schema.apiUsage.keyId, ids);
  const requests = await db()
    .select({ keyId: schema.apiUsage.keyId, endpoint: schema.apiUsage.endpoint, status: schema.apiUsage.status, ms: schema.apiUsage.ms, at: schema.apiUsage.at })
    .from(schema.apiUsage)
    .where(mine)
    .orderBy(desc(schema.apiUsage.at))
    .limit(20);
  const day = sql<string>`to_char(${schema.apiUsage.at} at time zone 'America/Los_Angeles', 'YYYY-MM-DD')`;
  const days = await db()
    .select({ day, n: count })
    .from(schema.apiUsage)
    .where(and(mine, gte(schema.apiUsage.at, new Date(Date.now() - 7 * 86400_000))))
    .groupBy(day)
    .orderBy(day);
  const last24 = await db()
    .select({ keyId: schema.apiUsage.keyId, n: count })
    .from(schema.apiUsage)
    .where(and(mine, gte(schema.apiUsage.at, new Date(Date.now() - 86400_000))))
    .groupBy(schema.apiUsage.keyId);
  return ok(
    {
      keys: keys.map((k) => ({
        id: k.id,
        prefix: k.prefix,
        name: k.name,
        created_at: k.createdAt,
        last_used_at: k.lastUsedAt,
        revoked: Boolean(k.revokedAt),
        calls_24h: last24.find((t) => t.keyId === k.id)?.n ?? 0,
      })),
      requests: requests.map((r) => ({ endpoint: r.endpoint, status: r.status, ms: r.ms, at: r.at, prefix: keys.find((k) => k.id === r.keyId)?.prefix ?? "" })),
      days,
    },
    started,
  );
}
