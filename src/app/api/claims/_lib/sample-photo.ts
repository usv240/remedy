/**
 * Brightline's published sample photo: its fictional charger with the cord cut (public/samples/charger/cord-cut.jpg,
 * Dmitry G, Wikimedia Commons, public domain). The claim page of the sample shop's recall offers it to visitors who have
 * no charger to cut, so that every visitor can buy, claim and see the refund go back to their purchase. A claim with
 * this exact photo on the sample recall runs every check as usual; it is only kept out of the earlier-claims pool, so
 * the next visitor's claim with it is not taken for a reused photo. Any other photo joins the pool. Server only.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SHOP_RECALL } from "./terms";

export const SAMPLE_PHOTO_FILE = path.join("public", "samples", "charger", "cord-cut.jpg");

let sha: string | null | undefined;
/** The published sample photo's SHA-256, read once, or null when the file is not there. */
export function samplePhotoSha(): string | null {
  if (sha !== undefined) return sha;
  const file = path.join(process.cwd(), SAMPLE_PHOTO_FILE);
  sha = existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
  return sha;
}

/** Whether these bytes are the published sample photo, sent for the sample shop's recall. */
export function isSamplePhoto(recallNumber: string, bytes: Uint8Array): boolean {
  const known = samplePhotoSha();
  return Boolean(known) && recallNumber === SHOP_RECALL && createHash("sha256").update(bytes).digest("hex") === known;
}
