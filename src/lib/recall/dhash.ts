/**
 * 64-bit difference hash (dHash) for photos, with Hamming distance. Two photos of the same picture (resaved, resized,
 * lightly cropped, recompressed) land within a few bits; different pictures land far apart. Used for the "your own
 * photo" check (C3): a claim photo is compared with the claimed recall's own official images and that recall's earlier
 * claim photos, at each orientation, and counts as the same picture at `SAME_PICTURE_MAX_DISTANCE` bits or fewer.
 * Server-only (sharp).
 */
//
// Remedy has one dHash: src/lib/verify/dhash.ts, re-exported here so recall ingest and the photo verifier always hash
// the same way. Hashes from two different pipelines differ by up to 9 bits on the same image, which would break the
// 10-bit threshold. On the fixtures that version separates better: copies at 1 and 10 bits (a quarter turn, and a
// 4 degree tilt with a 6 percent crop) against 2 and 12 for the earlier sharp-resize version here, and different
// official images at least 15 bits apart against 13.
export { SAME_PICTURE_MAX_DISTANCE, dhash, dhashRotations, hamming, isSamePicture, nearest, type DhashInput } from "../verify/dhash";
