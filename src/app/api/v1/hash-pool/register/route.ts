import { randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/api/envelope";
import { guard, keyFirm, POOL_WRITE_SCOPE } from "@/lib/api/keys";
import { HashPoolRegisterRequest } from "@/lib/api/v1-schemas";
import { audit } from "@/lib/audit";
import { db, dbConfigured, schema } from "@/lib/db";
import { log } from "@/lib/log";

/**
 * POST /api/v1/hash-pool/register: { dhash, phash?, recall_number, ref? }. A connected firm adds the hash of a photo it has
 * paid on, so the same photo sent to any other firm is held before a person sees it. Stored as image_hash source
 * "partner" with the firm's own opaque ref (or a UUID). Registering the same ref twice changes nothing.
 *
 * Who may write: only a key tied to a firm connected to Remedy (scope hash-pool:register and firm:<id>, src/lib/api/keys.ts).
 * A self-serve sandbox key is refused with a plain 403, so nobody outside a firm can put hashes in the pool. Who may
 * read: anyone, through /check, key or not. What crosses: the 64-bit hash (and the optional second hash) and an opaque ref. The registering firm is
 * written to Remedy's audit ledger for accountability, never to the pool row, so a hit can never name it.
 */
export async function POST(req: Request) {
  return guard(req, "v1.hash-pool.register", async () => {
    const started = Date.now();
    const body = await req.json().catch(() => null);
    if (!body) return fail("invalid_request", 'The request body must be JSON, for example { "dhash": "337bfb9f4e7f3e0f", "recall_number": "BH-2026-01" }.', 400);
    const parsed = HashPoolRegisterRequest.safeParse(body);
    if (!parsed.success) return fail("invalid_request", parsed.error.issues[0]?.message ?? "The request is not valid.", 422, parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    if (!dbConfigured()) return fail("upstream_unavailable", "The shared hash pool is not connected on this server, so nothing can be registered. The check endpoint still answers.", 503);
    const caller = await keyFirm(req);
    if (!caller) return fail("unauthorized", "Registering a hash needs a firm key: a key tied to a firm connected to Remedy. Checking a hash needs no key.", 401);
    if (caller.firmId === null) {
      return fail(
        "forbidden",
        `This key can check hashes but not register them. Registering is for firms connected to Remedy, each with a key tied to its firm (scope ${POOL_WRITE_SCOPE}), so the shared pool holds only photos a firm has paid on.`,
        403,
      );
    }
    const firmId = caller.firmId;
    const ref = parsed.data.ref ?? randomUUID();
    try {
      const inserted = await db()
        .insert(schema.imageHashes)
        .values({ source: "partner", ref, recallNumber: parsed.data.recall_number, dhash: parsed.data.dhash, phash: parsed.data.phash?.toLowerCase() ?? null })
        .onConflictDoNothing()
        .returning({ id: schema.imageHashes.id });
      const registered = inserted.length > 0;
      // Accountability inside Remedy: which firm wrote the row. The pool row and every answer from /check leave it out.
      if (registered) await audit("system", "hash_pool.registered", `firm:${firmId}`, { recall: parsed.data.recall_number, ref, dhash: parsed.data.dhash });
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
