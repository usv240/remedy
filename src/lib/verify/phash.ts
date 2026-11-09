import { readFileSync } from "node:fs";
import path from "node:path";
import { hamming, isHash, type DhashInput, type HashMatch } from "./dhash";
import { decodeHashGrey, type Grey } from "./image";
import type { HashRef } from "./types";

/**
 * Remedy's second 64-bit perceptual hash, computed beside the dHash (./dhash.ts) and built to hold where the dHash lets
 * go: a copy cropped by a few percent or turned a few degrees.
 *
 * What it hashes: the central 70 percent of the picture (PHASH_REGION), sampled onto a 32 x 32 grid (3 x 3 samples a
 * cell, bilinear), then a DCT-II, then the 8 x 8 lowest frequencies, one bit each: above their median or not. The
 * center leaves out the borders a crop or a turn changes first; the low frequencies keep the picture's broad layout and
 * drop the edge detail a re-save, a resize or a few degrees of turn disturb.
 *
 * A stored hash is that upright center. A photo being checked is hashed in a few framings (phashFramings): the center
 * a little wider, as if the photo had been cropped up to about 10 percent an edge; turned back 2.5 and 5 degrees either
 * way, with and without the white corners a turn adds; and mirrored. The nearest framing is the distance. Matching is
 * by Hamming distance, as for the dHash, and the threshold is set from the measurement in
 * content/public/hash-reuse-run.json (PHASH_MAX_DISTANCE).
 */

/** The share of each side the stored hash covers, around the center. */
export const PHASH_REGION = 0.7;
/**
 * The new hash's threshold, set from content/public/hash-reuse-run.json (scripts/public/hash-reuse-run.ts): the nearest
 * picture a copy is not a copy of (every other recall's distinct published pictures and the other source photos) came
 * 8 bits from it, so the threshold sits two bits inside that, the one bit a platform's image library may round
 * differently plus one. At 6 bits no copy matched an unrelated picture; at 8, one did. tests/hash-reuse-run.test.ts
 * fails if the recorded run says otherwise.
 */
export const PHASH_MAX_DISTANCE = 6;

const GRID = 32;
const SUB = 3;
const LOW = 8;

type Framing = { name: string; angle: number; fx: number; fy: number; mirror: boolean };

/** One grey value at (x, y), bilinear; outside the picture is white, like the corners a turn adds. */
function at(g: Grey, x: number, y: number): number {
  if (x < 0 || y < 0 || x > g.width - 1 || y > g.height - 1) return 255;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;
  const a = g.data[y0 * g.width + x0];
  const b = g.data[y0 * g.width + x1];
  const c = g.data[y1 * g.width + x0];
  const d = g.data[y1 * g.width + x1];
  return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
}

/** The framing's region, sampled onto the 32 x 32 grid. */
function sample(g: Grey, f: Framing): Float64Array {
  const out = new Float64Array(GRID * GRID);
  const cx = (g.width - 1) / 2;
  const cy = (g.height - 1) / 2;
  const rw = f.fx * g.width;
  const rh = f.fy * g.height;
  const rad = (f.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let v = 0; v < GRID; v++) {
    for (let u = 0; u < GRID; u++) {
      let sum = 0;
      for (let j = 0; j < SUB; j++) {
        for (let i = 0; i < SUB; i++) {
          let lx = ((u + (i + 0.5) / SUB) / GRID - 0.5) * rw;
          const ly = ((v + (j + 0.5) / SUB) / GRID - 0.5) * rh;
          if (f.mirror) lx = -lx;
          sum += at(g, cx + lx * cos - ly * sin, cy + lx * sin + ly * cos);
        }
      }
      out[v * GRID + u] = sum / (SUB * SUB);
    }
  }
  return out;
}

/** cos(pi (2n + 1) k / 64) for the eight lowest frequencies. */
const BASIS: Float64Array[] = Array.from({ length: LOW }, (_, k) => Float64Array.from({ length: GRID }, (_, n) => Math.cos((Math.PI * (2 * n + 1) * k) / (2 * GRID))));

/** The 8 x 8 lowest DCT-II frequencies of the grid, one bit each against their median, as 16 hex characters. */
function bits(grid: Float64Array): string {
  const rows = new Float64Array(GRID * LOW);
  for (let y = 0; y < GRID; y++) for (let k = 0; k < LOW; k++) {
    let s = 0;
    for (let x = 0; x < GRID; x++) s += grid[y * GRID + x] * BASIS[k][x];
    rows[y * LOW + k] = s;
  }
  const coef: number[] = [];
  for (let l = 0; l < LOW; l++) for (let k = 0; k < LOW; k++) {
    let s = 0;
    for (let y = 0; y < GRID; y++) s += rows[y * LOW + k] * BASIS[l][y];
    coef.push(s);
  }
  const sorted = [...coef].sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  let hi = 0;
  let lo = 0;
  coef.forEach((c, i) => {
    const bit = c > median ? 1 : 0;
    if (i < 32) hi = (hi << 1) | bit;
    else lo = (lo << 1) | bit;
  });
  return (hi >>> 0).toString(16).padStart(8, "0") + (lo >>> 0).toString(16).padStart(8, "0");
}

const UPRIGHT: Framing = { name: "upright center", angle: 0, fx: PHASH_REGION, fy: PHASH_REGION, mirror: false };

/**
 * The framings a checked photo is hashed in: the stored center; that center a little wider (a copy cropped about 4, 7
 * and 10 percent an edge shows the same content there); turned back 2.5 and 5 degrees either way, once as if the turn
 * added white corners around the picture and once as if it was cropped to the picture; and mirrored.
 */
function framings(g: Grey): Framing[] {
  const out: Framing[] = [UPRIGHT];
  for (const c of [0.04, 0.07, 0.1]) {
    const f = PHASH_REGION / (1 - 2 * c);
    out.push({ name: `center widened for a ${Math.round(c * 100)} percent crop`, angle: 0, fx: f, fy: f, mirror: false });
  }
  for (const deg of [-5, -2.5, 2.5, 5]) {
    const r = (Math.abs(deg) * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    // The picture's own size inside a canvas a turn has enlarged: W' = W cos + H sin, H' = W sin + H cos.
    const w = (g.width * c - g.height * s) / (c * c - s * s);
    const h = (g.height * c - g.width * s) / (c * c - s * s);
    // A picture too narrow for the turn to be undone this way keeps only the cropped framing.
    if (w > 0 && h > 0) out.push({ name: `turned back ${Math.abs(deg)} degrees ${deg < 0 ? "left" : "right"}, white corners`, angle: deg, fx: (PHASH_REGION * w) / g.width, fy: (PHASH_REGION * h) / g.height, mirror: false });
    out.push({ name: `turned back ${Math.abs(deg)} degrees ${deg < 0 ? "left" : "right"}, cropped`, angle: deg, fx: PHASH_REGION, fy: PHASH_REGION, mirror: false });
  }
  out.push({ name: "mirrored", angle: 0, fx: PHASH_REGION, fy: PHASH_REGION, mirror: true });
  return out;
}

/** The stored hash of a greyscale raster: its upright center. */
export function phashGrey(g: Grey): string {
  return bits(sample(g, UPRIGHT));
}

/** Every framing's hash of a greyscale raster, the stored one first, with each framing's name. */
export function phashFramings(g: Grey): { name: string; phash: string }[] {
  return framings(g).map((f) => ({ name: f.name, phash: bits(sample(g, f)) }));
}

/** The stored hash of an image file, from the same decode the dHash uses (EXIF orientation, fit inside 256 px). */
export async function phash(input: DhashInput): Promise<string> {
  return phashGrey(await decodeHashGrey(input instanceof ArrayBuffer ? new Uint8Array(input) : input));
}

/** The nearest distance between any framing of a photo and a stored hash, and which framing it was. */
export function phashDistance(framed: { name: string; phash: string }[], stored: string): { distance: number; framing: string | null } {
  if (!isHash(stored)) return { distance: 65, framing: null };
  let best = { distance: 65, framing: null as string | null };
  for (const f of framed) {
    const d = hamming(f.phash, stored);
    if (d < best.distance) best = { distance: d, framing: f.name };
  }
  return best;
}

/**
 * The closest earlier photo by the second hash, or null when none is within `maxDistance`. Only refs that carry a
 * second hash count: an earlier claim photo or a registered pool hash (image_hash.phash). Published pictures stay on
 * the dHash. The match reads like a dHash match, with the framing that found it as its orientation.
 */
export function phashMatch(framed: { name: string; phash: string }[], refs: readonly HashRef[], maxDistance = PHASH_MAX_DISTANCE): HashMatch | null {
  let best: HashMatch | null = null;
  for (const r of refs) {
    if (!r.phash || !isHash(r.phash)) continue;
    const d = phashDistance(framed, r.phash.toLowerCase());
    if (d.distance <= maxDistance && (!best || d.distance < best.distance)) best = { ref: r.ref, dhash: r.dhash.toLowerCase(), distance: d.distance, orientation: `second hash, ${d.framing ?? "upright center"}`, caption: r.caption ?? null };
  }
  return best;
}

let stored: Record<string, string> | null = null;

/**
 * Every stored official picture's new hash, by picture URL (content/recalls/image-phashes.json, written by
 * scripts/recalls/phashes.ts from the committed 320 px thumbnails in public/recalls). Server only.
 */
export function storedPhashes(): Record<string, string> {
  if (stored) return stored;
  try {
    stored = (JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "image-phashes.json"), "utf8")) as { hashes: Record<string, string> }).hashes;
  } catch {
    stored = {};
  }
  return stored;
}
