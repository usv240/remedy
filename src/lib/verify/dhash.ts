import { readFileSync } from "node:fs";
import path from "node:path";
import { decodeHashGrey, type Grey } from "./image";
import type { HashRef } from "./types";

/**
 * Remedy's one 64-bit difference hash (dHash), for the own-photo check (C3) and for every stored image hash.
 * src/lib/recall/dhash.ts re-exports this file, so official hashes at ingest and claim hashes always agree.
 *
 * Pipeline: orient by EXIF, flatten transparency onto white, greyscale, fit inside 256 x 256, then box-average into a
 * 9 x 8 grid and set one bit per row neighbour pair (bit = left cell brighter than right cell), row by row, most
 * significant bit first, as 16 lowercase hex characters. A stored hash is the upright image; the photo being checked is
 * hashed in all eight orientations (four turns, each mirrored or not), so a turned or flipped copy still matches.
 *
 * Chosen over the earlier sharp-resize version on the fixtures: copies at 1 and 10 bits (a 90 degree turn, and a
 * 4 degree tilt with a 6 percent crop) against 2 and 12, and different official images at least 15 bits apart against 13.
 *
 * Scope: most official images are product shots on white, and 447 of 1,821 sit within 10 bits of an image from a
 * different recall with this hash (559 with the earlier one). A claim photo is compared only with the claimed recall's own official images and that recall's
 * earlier claim photos. The screen-or-printout reading in the vision call is the main own-photo signal.
 */

/** Hamming distance at or under this is the same picture. */
export const DUPLICATE_MAX_DISTANCE = 10;
export const SAME_PICTURE_MAX_DISTANCE = DUPLICATE_MAX_DISTANCE;
/** A hash this flat (almost no edges) says nothing about which photo it came from, so it is never matched. */
const MIN_DETAIL_BITS = 4;

export type DhashInput = Buffer | Uint8Array | ArrayBuffer;
const toBytes = (input: DhashInput): Uint8Array => (input instanceof ArrayBuffer ? new Uint8Array(input) : input);

type Orientation = { turns: 0 | 1 | 2 | 3; mirror: boolean };
const ORIENTATIONS: Orientation[] = [0, 1, 2, 3].flatMap((turns) => [false, true].map((mirror) => ({ turns: turns as Orientation["turns"], mirror })));
const ORIENTATION_NAMES = ORIENTATIONS.map((o) => `${o.turns === 0 ? "upright" : `turned ${o.turns * 90}`}${o.mirror ? ", mirrored" : ""}`);
const QUARTER_TURNS = [0, 2, 4, 6];

/** Read pixel (x, y) of the image as it looks after `turns` quarter turns clockwise, then an optional mirror. */
function view(g: Grey, o: Orientation) {
  const odd = o.turns % 2 === 1;
  const width = odd ? g.height : g.width;
  const height = odd ? g.width : g.height;
  const at = (x0: number, y: number) => {
    const x = o.mirror ? width - 1 - x0 : x0;
    let sx: number;
    let sy: number;
    switch (o.turns) {
      case 0:
        sx = x;
        sy = y;
        break;
      case 1:
        sx = y;
        sy = g.height - 1 - x;
        break;
      case 2:
        sx = g.width - 1 - x;
        sy = g.height - 1 - y;
        break;
      default:
        sx = g.width - 1 - y;
        sy = x;
        break;
    }
    return g.data[sy * g.width + sx];
  };
  return { width, height, at };
}

/** Box-average the view into a cols x rows grid. */
function cells(g: Grey, o: Orientation, cols = 9, rows = 8): number[] {
  const v = view(g, o);
  const out = new Array<number>(cols * rows).fill(0);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * v.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * v.height) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * v.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * v.width) / cols));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += v.at(x, y);
      out[r * cols + c] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

function hashOf(g: Grey, o: Orientation): string {
  const grid = cells(g, o);
  let hi = 0;
  let lo = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const bit = grid[r * 9 + c] > grid[r * 9 + c + 1] ? 1 : 0;
      if (r < 4) hi = (hi << 1) | bit;
      else lo = (lo << 1) | bit;
    }
  }
  return (hi >>> 0).toString(16).padStart(8, "0") + (lo >>> 0).toString(16).padStart(8, "0");
}

/** The upright hash of a greyscale raster. */
export function dhashGrey(g: Grey): string {
  return hashOf(g, ORIENTATIONS[0]);
}

/** Hashes of all eight orientations; the first is upright. */
export function dhashVariants(g: Grey): string[] {
  return ORIENTATIONS.map((o) => hashOf(g, o));
}

/** The upright hash of an image file (JPEG, PNG, WebP, GIF, AVIF). Use this for every stored hash. */
export async function dhash(input: DhashInput): Promise<string> {
  return dhashGrey(await decodeHashGrey(toBytes(input)));
}

/** The hash at 0, 90, 180 and 270 degrees, so a turned copy of a picture still matches. */
export async function dhashRotations(input: DhashInput): Promise<string[]> {
  const all = dhashVariants(await decodeHashGrey(toBytes(input)));
  return QUARTER_TURNS.map((i) => all[i]);
}

/** The upright hash to store, and all eight orientations to match with. */
export async function photoHashes(input: DhashInput): Promise<{ dhash: string; variants: string[] }> {
  const variants = dhashVariants(await decodeHashGrey(toBytes(input)));
  return { dhash: variants[0], variants };
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export const isHash = (h: string) => /^[0-9a-f]{16}$/i.test(h);

/** Number of differing bits between two 64-bit hashes (0 to 64). */
export function hamming(a: string, b: string): number {
  if (!isHash(a) || !isHash(b)) throw new Error("A dHash is 16 hex characters.");
  const x = (parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0;
  const y = (parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0;
  return popcount32(x) + popcount32(y);
}

/** Set bits in a hash: near zero means a nearly flat image. */
export const detailBits = (h: string) => hamming(h, "0000000000000000");

export type HashMatch = { ref: string; dhash: string; distance: number; orientation: string; caption: string | null };

/** The closest stored hash to any orientation of the photo, or null when nothing is within `maxDistance`. Flat hashes are ignored. */
export function closestMatch(variants: string[], refs: readonly HashRef[], maxDistance = DUPLICATE_MAX_DISTANCE): HashMatch | null {
  if (!variants.length || detailBits(variants[0]) < MIN_DETAIL_BITS) return null;
  let best: HashMatch | null = null;
  for (const r of refs) {
    if (!isHash(r.dhash) || detailBits(r.dhash) < MIN_DETAIL_BITS) continue;
    variants.forEach((v, i) => {
      const d = hamming(v, r.dhash);
      if (!best || d < best.distance) best = { ref: r.ref, dhash: r.dhash.toLowerCase(), distance: d, orientation: variants.length === 4 ? ORIENTATION_NAMES[QUARTER_TURNS[i]] : (ORIENTATION_NAMES[i] ?? `variant ${i}`), caption: r.caption ?? null };
    });
  }
  const found = best as HashMatch | null;
  return found && found.distance <= maxDistance ? found : null;
}

/** The nearest distance to each ref, for Technical view and calibration. */
export function nearestDistances(variants: string[], refs: readonly HashRef[]): { ref: string; distance: number }[] {
  if (!variants.length) return [];
  return refs
    .filter((r) => isHash(r.dhash))
    .map((r) => ({ ref: r.ref, distance: Math.min(...variants.map((v) => hamming(v, r.dhash))) }))
    .sort((a, b) => a.distance - b.distance);
}

/** The closest reference to any of the photo's hashes: its distance and which reference it was (65 and null when none). */
export function nearest(photoHashList: string[], refs: { ref: string; dhash: string }[]): { distance: number; ref: string | null } {
  const n = nearestDistances(photoHashList, refs)[0];
  return n ? { distance: n.distance, ref: n.ref } : { distance: 65, ref: null };
}

/** True when the photo is the same picture as one of the references, at any of the given orientations. */
export const isSamePicture = (photoHashList: string[], refs: { ref: string; dhash: string }[], max = SAME_PICTURE_MAX_DISTANCE) => nearest(photoHashList, refs).distance <= max;

let stored: Record<string, { url: string; dhash: string; caption?: string }[]> | null = null;

/**
 * The stored hashes of one recall's own official images (content/recalls/image-hashes.json, written at ingest with
 * `dhash` above). Empty when the recall is not in the file, for example a recall pasted in by number. Server only.
 */
export function storedOfficialHashes(recallNumber: string): HashRef[] {
  if (!stored) {
    try {
      stored = JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "image-hashes.json"), "utf8"));
    } catch {
      stored = {};
    }
  }
  return (stored?.[recallNumber] ?? []).filter((i) => isHash(i.dhash)).map((i) => ({ ref: i.url, dhash: i.dhash.toLowerCase(), caption: i.caption ?? null }));
}
