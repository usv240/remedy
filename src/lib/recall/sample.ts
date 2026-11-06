/**
 * Seeded, stratified sampling for the proof-rule benchmark. Pure and repeatable: the same recalls, seed and sizes
 * always give the same sample.
 */
import type { Recall } from "./types";

/** mulberry32: a small, well-known seeded PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Proportional allocation with largest remainders, every non-empty stratum getting at least one when n allows. */
export function allocate(sizes: Record<string, number>, n: number): Record<string, number> {
  const keys = Object.keys(sizes).filter((k) => sizes[k] > 0).sort();
  const total = keys.reduce((s, k) => s + sizes[k], 0);
  if (!total) return {};
  const target = Math.min(n, total);
  const exact = keys.map((k) => ({ k, q: (sizes[k] / total) * target }));
  const out: Record<string, number> = Object.fromEntries(exact.map((e) => [e.k, Math.min(sizes[e.k], Math.floor(e.q))]));
  if (target >= keys.length) for (const k of keys) if (out[k] === 0) out[k] = 1;
  let left = target - Object.values(out).reduce((s, v) => s + v, 0);
  const order = [...exact].sort((a, b) => b.q - Math.floor(b.q) - (a.q - Math.floor(a.q)) || a.k.localeCompare(b.k));
  while (left > 0) {
    let moved = false;
    for (const e of order) {
      if (left === 0) break;
      if (out[e.k] < sizes[e.k]) {
        out[e.k]++;
        left--;
        moved = true;
      }
    }
    if (!moved) break;
  }
  while (left < 0) {
    const k = [...keys].sort((a, b) => out[b] - out[a])[0];
    out[k]--;
    left++;
  }
  return out;
}

export function stratifiedSample<T>(items: T[], stratum: (x: T) => string, n: number, seed: number): { picked: T[]; allocation: Record<string, number>; sizes: Record<string, number> } {
  const groups = new Map<string, T[]>();
  for (const x of items) {
    const k = stratum(x);
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const sizes = Object.fromEntries([...groups].map(([k, v]) => [k, v.length]));
  const allocation = allocate(sizes, n);
  const rand = rng(seed);
  const picked: T[] = [];
  for (const k of Object.keys(allocation).sort()) picked.push(...shuffle(groups.get(k)!, rand).slice(0, allocation[k]));
  return { picked, allocation, sizes };
}

/** Photo-refund strata: recall year by the kind of proof (marker, cut, other). */
export const photoStratum = (r: Recall) => `${r.date.slice(0, 4)}|${r.flags.marker ? "marker" : r.flags.cut ? "cut" : "other"}`;
/** Non-photo strata: recall year by remedy option. */
export const otherStratum = (r: Recall) =>
  `${r.date.slice(0, 4)}|${r.remedies.includes("Refund") ? "refund" : r.remedies.includes("Replace") ? "replace" : r.remedies.includes("Repair") ? "repair" : "other"}`;

export const BENCH_SEED = 20261105;

export function benchmarkSample(recalls: Recall[], seed = BENCH_SEED) {
  const photo = stratifiedSample(recalls.filter((r) => r.photoRefund), photoStratum, 100, seed);
  const other = stratifiedSample(recalls.filter((r) => !r.flags.photo), otherStratum, 30, seed + 1);
  return { photo, other };
}
