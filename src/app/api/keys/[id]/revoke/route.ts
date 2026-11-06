import { and, eq, isNull } from "drizzle-orm";
import { fail, ok } from "@/lib/api/envelope";
import { ownedKeyId } from "@/lib/api/keys";
import { audit } from "@/lib/audit";
import { db, schema } from "@/lib/db";

/** POST /api/keys/{id}/revoke: stop a key working at once. Only the browser that created it can revoke it. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  const owned = await ownedKeyId(ctx.params);
  if (!owned) return fail("not_found", "That key was not found in this browser.", 404);
  const [row] = await db()
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, owned.id), eq(schema.apiKeys.ownerId, owned.ownerId), isNull(schema.apiKeys.revokedAt)))
    .returning();
  if (!row) return fail("not_found", "That key was not found in this browser, or it is already revoked.", 404);
  await audit("person", "developer.key.revoked", `key:${row.id}`, { prefix: row.prefix });
  return ok({ id: row.id, revoked: true }, started);
}
