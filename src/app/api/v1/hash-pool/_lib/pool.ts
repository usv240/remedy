import { CATALOG_MAX_DISTANCE, catalogOfficialHashes, closestMatch, DUPLICATE_MAX_DISTANCE, storedOfficialHashes, type CatalogRef } from "@/lib/verify/dhash";
import { PHASH_MAX_DISTANCE, phashMatch } from "@/lib/verify/phash";

/**
 * The shared hash pool, as another firm sees it: one 64-bit dHash goes in (and optionally the second 64-bit hash,
 * src/lib/verify/phash.ts), a hit or no hit comes out, with the distance
 * and the holding row's opaque ref. Nothing else crosses: not the holder's recall, firm, photo or amount. This is the
 * same comparison the claim route makes (src/app/api/claims/_lib/claims.ts, elsewhereHashes), factored out so it can
 * be answered to a caller and tested with no database.
 */

export type PoolSource = "claim" | "partner";
/** One row of image_hash the claim route and this pool both read. `recallNumber` stays on the server side. */
export type PoolRow = { ref: string; dhash: string; source: PoolSource; recallNumber: string | null; phash?: string | null };

export type PoolCheck = {
  hit: boolean;
  /** Hamming distance of the closest row that counted, or null when nothing was within its threshold. */
  distance: number | null;
  /** The threshold that applied to the hit: 10 for the claimed recall's own pictures and claim photos, 4 for everything else. */
  threshold_bits: number | null;
  /** The holding row's opaque ref: a photo row id, or the ref a connected firm registered. Opens nothing elsewhere. */
  ref: string | null;
  source: PoolSource | "official" | null;
  /** Which hash matched: the dHash, or the second hash (which holds under a small crop or turn). */
  hash: "dhash" | "phash" | null;
  pool: { claim_rows: number; partner_rows: number; published_pictures: number };
};

type Candidate = { distance: number; threshold: number; ref: string; source: PoolCheck["source"]; hash: "dhash" | "phash" };

/**
 * The pool check. `rows` are the claim and partner hashes (every recall, every firm); `published` defaults to the
 * distinct published pictures of every recall (catalogOfficialHashes), and the claimed recall's own pictures come
 * from storedOfficialHashes when `recallNumber` is given. A flat hash (almost no edges) never matches, as in closestMatch.
 */
export function checkPool(dhash: string, recallNumber: string | null, rows: readonly PoolRow[], published: readonly CatalogRef[] = catalogOfficialHashes(), phash: string | null = null): PoolCheck {
  const h = dhash.toLowerCase();
  const own = recallNumber ? rows.filter((r) => r.recallNumber === recallNumber) : [];
  const others = recallNumber ? rows.filter((r) => r.recallNumber !== recallNumber) : rows;
  const found: Candidate[] = [];
  const consider = (refs: readonly { ref: string; dhash: string }[], threshold: number, sourceOf: (ref: string) => PoolCheck["source"]) => {
    const m = closestMatch([h], refs, threshold);
    if (m) found.push({ distance: m.distance, threshold, ref: m.ref, source: sourceOf(m.ref), hash: "dhash" });
  };
  // The second hash, when given, against the claim and partner rows that carry one (published pictures stay on the dHash).
  const considerP = (list: readonly PoolRow[]) => {
    if (!phash) return;
    const m = phashMatch([{ name: "upright center", phash: phash.toLowerCase() }], list, PHASH_MAX_DISTANCE);
    if (m) found.push({ distance: m.distance, threshold: PHASH_MAX_DISTANCE, ref: m.ref, source: list.find((r) => r.ref === m.ref)?.source ?? null, hash: "phash" });
  };
  const sourceOf = (list: readonly PoolRow[]) => (ref: string) => list.find((r) => r.ref === ref)?.source ?? null;
  if (recallNumber) {
    consider(own, DUPLICATE_MAX_DISTANCE, sourceOf(own));
    consider(storedOfficialHashes(recallNumber), DUPLICATE_MAX_DISTANCE, () => "official");
  }
  consider(others, CATALOG_MAX_DISTANCE, sourceOf(others));
  considerP(own);
  considerP(others);
  consider(
    published.filter((p) => p.recall !== recallNumber),
    CATALOG_MAX_DISTANCE,
    () => "official",
  );
  found.sort((a, b) => a.distance - b.distance || a.threshold - b.threshold);
  const best = found[0] ?? null;
  return {
    hit: Boolean(best),
    distance: best?.distance ?? null,
    threshold_bits: best?.threshold ?? null,
    ref: best?.ref ?? null,
    source: best?.source ?? null,
    hash: best?.hash ?? null,
    pool: { claim_rows: rows.filter((r) => r.source === "claim").length, partner_rows: rows.filter((r) => r.source === "partner").length, published_pictures: published.length },
  };
}

/** The fields a pool answer may carry: tests hold the route to this list, so nothing else can cross. */
export const POOL_ANSWER_FIELDS = ["hit", "distance", "threshold_bits", "ref", "source", "hash", "pool"] as const;
