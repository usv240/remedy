/**
 * How long a claim photo is kept, and the two ways its bytes are deleted. Server only.
 *
 * What is stored: photo.bytes is the resized JPEG that sharp re-encodes for the receipt and the firm's queue, and
 * sharp writes no EXIF or GPS metadata into it (tests/photo-privacy.test.ts checks this). photo.original, the owner's
 * untouched upload, is held only until the checks have run on it.
 *
 * When the bytes go (sha256 and dhash stay on the row, and image_hash rows stay, so the own-photo check still knows a
 * photo it no longer holds):
 *  - at once, when the vision check sees a person in the photo (removePhoto, reason "person");
 *  - PHOTO_KEEP_DAYS after the claim is decided, for owners' uploads (prunePhotos, reason "retention"), run from the
 *    same housekeeping path as the rate-limit and request-log prunes (src/lib/ops/prune.ts).
 * Each removal writes a ledger entry with the reason and the photo's id only, never image data.
 */
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db";

/** The stored copy's longest side, for the receipt and the firm's queue. */
export const STORED_MAX_SIDE = 1600;

/**
 * The copy kept for the receipt and the firm's queue: turned upright, at most 1,600 px, re-encoded as JPEG. sharp
 * writes no metadata unless asked to, so the copy carries no EXIF or GPS (tests/photo-privacy.test.ts). A format
 * sharp cannot read (HEIC) keeps no copy at all; the checks then ask for a JPEG.
 */
export async function storedCopy(bytes: Buffer): Promise<{ bytes: Buffer; mime: string; width: number; height: number } | null> {
  try {
    const out = await sharp(bytes, { failOn: "error", limitInputPixels: 60_000_000 })
      .rotate()
      .resize(STORED_MAX_SIDE, STORED_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: out.data, mime: "image/jpeg", width: out.info.width, height: out.info.height };
  } catch {
    return null;
  }
}

/** The ledger, loaded when first needed: it imports the logger, which imports the prune that imports this file. */
const ledger = async () => (await import("../audit")).audit;

export const PHOTO_KEEP_DAYS = 90;
/** An untouched upload whose checks never finished is cleared after a day all the same. */
export const ORIGINAL_KEEP_HOURS = 24;

export type RemovalReason = "person" | "retention";

/** Delete one photo's bytes now and record why. Returns whether there was anything to delete. */
export async function removePhoto(photoId: string, reason: RemovalReason, ref: string): Promise<boolean> {
  const r = await db().execute(sql`
    update photo set bytes = null, original = null, storage_path = null, removed_at = now(), removed_reason = ${reason}
    where id = ${photoId}::uuid and (bytes is not null or original is not null or storage_path is not null)
    returning id`);
  const removed = r.rows.length > 0;
  if (removed) await (await ledger())("system", "photo.removed", ref, { photo: photoId, reason, image_data: "none kept; sha256 and dhash stay" });
  return removed;
}

/** The moment before which a decided claim's photo is past its keep period. */
export const retentionCutoff = (now: Date, days = PHOTO_KEEP_DAYS) => new Date(now.getTime() - days * 86_400_000);

/**
 * Delete the bytes of owners' photos whose claim was decided more than PHOTO_KEEP_DAYS ago (or, for a photo with no
 * decided claim, created that long ago), and every untouched upload older than ORIGINAL_KEEP_HOURS. Sample and preset
 * photos (public CPSC and Commons images) are not owners' photos and stay.
 */
export async function prunePhotos(now = new Date()): Promise<{ removed: number; originals: number }> {
  const cutoff = retentionCutoff(now);
  const originalCutoff = new Date(now.getTime() - ORIGINAL_KEEP_HOURS * 3_600_000);
  const old = await db().execute(sql`
    update photo p set bytes = null, original = null, storage_path = null, removed_at = ${now}, removed_reason = 'retention'
    where p.source in ('upload', 'email')
      and (p.bytes is not null or p.original is not null or p.storage_path is not null)
      and coalesce((select max(c.decided_at) from claim c where c.photo_id = p.id), p.created_at) < ${cutoff}
    returning p.id`);
  const originals = await db().execute(sql`
    update photo set original = null where original is not null and created_at < ${originalCutoff} returning id`);
  const removed = old.rows.length;
  if (removed) await (await ledger())("system", "photo.retention", "photo:retention", { removed, keep_days: PHOTO_KEEP_DAYS, image_data: "none kept; sha256 and dhash stay" });
  return { removed, originals: originals.rows.length };
}
