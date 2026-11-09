import { randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { HashPoolRegisterRequest } from "@/lib/api/v1-schemas";
import { keyIdFor } from "@/lib/api/verify-service";
import { db, dbConfigured, schema } from "@/lib/db";
import { log } from "@/lib/log";

/**
 * POST /api/v1/hash-pool/register: { dhash, recall_number, ref? }. A connected firm adds the hash of a photo it has
 * paid on, so the same photo sent to any other firm is held before a person sees it. Stored as image_hash source
 * "partner" with the firm's own opaque ref (or a UUID); the key that registered it is not written to the row, so a hit
 * can never name the firm. Needs an API key. Registering the same ref twice changes nothing.
 */
export async function POST(req: Request) {
  return guard(req, "v1.hash-pool.register", async () => {
    const started = Date.now();
    const body = await req.json().catch(() => null);
    if (!body) return fail("invalid_request", 'The request body must be JSON, for example { "dhash": "337bfb9f4e7f3e0f", "recall_number": "BH-2026-01" }.', 400);
    const parsed = HashPoolRegisterRequest.safeParse(body);
    if (!parsed.success) return fail("invalid_request", parsed.error.issues[0]?.message ?? "The request is not valid.", 422, parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    if (!dbConfigured()) return fail("upstream_unavailable", "The shared hash pool is not connected on this server, so nothing can be registered. The check endpoint still answers.", 503);
    if (!(await keyIdFor(req))) return fail("unauthorized", "Registering a hash needs an API key. Get a free sandbox key on the Developers page.", 401);
    const ref = parsed.data.ref ?? randomUUID();
    try {
      const inserted = await db()
        .insert(schema.imageHashes)
        .values({ source: "partner", ref, recallNumber: parsed.data.recall_number, dhash: parsed.data.dhash })
        .onConflictDoNothing()
        .returning({ id: schema.imageHashes.id });
      const registered = inserted.length > 0;
      return ok(
        {
          registered,
          ref,
          dhash: parsed.data.dhash,
          note: registered ? "In the pool. A photo within 4 bits of this hash, sent on any other recall at any firm, is now held for a person." : "Already in the pool under this ref; nothing changed.",
        },
        started,
      );
    } catch (e) {
      log.error("v1.hash-pool.register failed", { error: e });
      return fail("internal", "The hash was not registered. Please try again.", 500);
    }
  });
}
