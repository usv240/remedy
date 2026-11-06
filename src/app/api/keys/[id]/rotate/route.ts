import { and, eq, isNull } from "drizzle-orm";
import { fail, ok } from "@/lib/api/envelope";
import { clientId, issueKey, ownedKeyId } from "@/lib/api/keys";
import { audit } from "@/lib/audit";
import { db, schema } from "@/lib/db";

/** POST /api/keys/{id}/rotate: issue a new key and revoke the old one in the same step. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  const owned = await ownedKeyId(ctx.params);
  if (!owned) return fail("not_found", "That key was not found in this browser.", 404);
  const [old] = await db()
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, owned.id), eq(schema.apiKeys.ownerId, owned.ownerId), isNull(schema.apiKeys.revokedAt)))
    .returning();
  if (!old) return fail("not_found", "That key was not found in this browser, or it is already revoked.", 404);
  const { key, row } = await issueKey({ name: old.name, email: old.email, purpose: old.purpose, ownerId: owned.ownerId, ip: clientId(req) });
  await audit("person", "developer.key.rotated", `key:${row.id}`, { from: old.prefix, to: row.prefix });
  return ok({ id: row.id, key, prefix: row.prefix, replaced: old.prefix }, started);
}
