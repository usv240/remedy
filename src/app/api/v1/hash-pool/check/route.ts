import { inArray } from "drizzle-orm";
import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { HashPoolCheckRequest } from "@/lib/api/v1-schemas";
import { db, dbConfigured, schema } from "@/lib/db";
import { log } from "@/lib/log";
import { checkPool, type PoolRow } from "../_lib/pool";

/**
 * POST /api/v1/hash-pool/check: { dhash, phash?, recall_number? }. Is this photo already in the shared pool? The answer is a
 * hit or no hit, the distance in bits, the threshold that applied and the holding row's opaque ref. No photo is
 * sent and nothing about the holder comes back. Works without a database: the pool is then empty and only the
 * published pictures of every recall are checked.
 */
export async function POST(req: Request) {
  return guard(req, "v1.hash-pool.check", async () => {
    const started = Date.now();
    const body = await req.json().catch(() => null);
    if (!body) return fail("invalid_request", 'The request body must be JSON, for example { "dhash": "337bfb9f4e7f3e0f" }.', 400);
    const parsed = HashPoolCheckRequest.safeParse(body);
    if (!parsed.success) return fail("invalid_request", parsed.error.issues[0]?.message ?? "The request is not valid.", 422, parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    try {
      const rows: PoolRow[] = dbConfigured()
        ? ((await db()
            .select({ ref: schema.imageHashes.ref, dhash: schema.imageHashes.dhash, phash: schema.imageHashes.phash, source: schema.imageHashes.source, recallNumber: schema.imageHashes.recallNumber })
            .from(schema.imageHashes)
            .where(inArray(schema.imageHashes.source, ["claim", "partner"]))
            .limit(50000)) as PoolRow[])
        : [];
      return ok(checkPool(parsed.data.dhash, parsed.data.recall_number ?? null, rows, undefined, parsed.data.phash ?? null), started);
    } catch (e) {
      log.error("v1.hash-pool.check failed", { error: e });
      return fail("internal", "The pool check did not finish. Please try again.", 500);
    }
  });
}
