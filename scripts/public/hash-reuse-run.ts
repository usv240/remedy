/**
 * Measures the shared hash pool against the copies a reused photo goes through, for /evidence#network and
 * docs/results.md. Code only: no model call, no network, no database.
 *
 *   npx tsx scripts/public/hash-reuse-run.ts
 *
 * Every owner-style photo in the repo with a known answer (content/verify/fixtures: the sample charger's three photos,
 * the three Wikimedia Commons photos, and the CPSC's three published made-safe examples) is put through the changes a
 * reuser makes before sending a photo again: saved as JPEG at three qualities, halved and quartered, cropped, turned a
 * few degrees, brightened and darkened, screenshotted on a phone, and mirrored. Each copy is hashed the way a claim
 * photo is (photoHashes: the upright 64-bit dHash and its eight orientations) and compared with the source photo's
 * stored upright hash the way the claim route compares it (closestMatch), at the two thresholds the route uses:
 * DUPLICATE_MAX_DISTANCE (10 bits, the same recall's earlier claims and pictures) and CATALOG_MAX_DISTANCE (4 bits,
 * every other recall's pictures and every other firm's claims).
 *
 * False matches: each copy is also compared with every picture it is not a copy of, at the same two thresholds. Those
 * are the other eight source photos' hashes, and every distinct published picture of every recall (catalogOfficialHashes)
 * except the source's own recall: the CPSC's made-safe example for recall 26125 is that recall's published picture, so a
 * match there is the same picture, not a false one. A different photograph of the same product (the three charger photos)
 * counts as unrelated: matching one with another would hold a photo nobody had sent before.
 *
 * The second hash (src/lib/verify/phash.ts) is measured beside it on the same copies: each copy hashed in its framings
 * (phashFramings) against the source's stored center hash, and against the same unrelated pictures (the other sources'
 * hashes, and every other recall's distinct published pictures from content/recalls/image-phashes.json). The run
 * reports, at each threshold, what the dHash alone catches, what the new hash alone catches, and what either catches,
 * with the unrelated matches for each, so the new hash's threshold (PHASH_MAX_DISTANCE) is set from it.
 *
 * Writes content/public/hash-reuse-run.json with every distance, so tests/hash-reuse-run.test.ts can derive the table again.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { CATALOG_MAX_DISTANCE, catalogOfficialHashes, closestMatch, DUPLICATE_MAX_DISTANCE, hamming, nearestDistances, photoHashes } from "@/lib/verify/dhash";
import { FIXTURES_DIR } from "@/lib/verify/fixtures";
import { decodeHashGrey } from "@/lib/verify/image";
import { PHASH_MAX_DISTANCE, PHASH_REGION, phashDistance, phashFramings, phashGrey, storedPhashes } from "@/lib/verify/phash";

const OUT = path.join(process.cwd(), "content", "public", "hash-reuse-run.json");

export type Source = { file: string; recall: string | null; what: string; credit: string };

/** The nine photos, each with the recall it was sent for (null for a photo of no recalled product) and its credit. */
export const SOURCES: Source[] = [
  { file: "sample/cord-cut.jpg", recall: "BH-2026-01", what: "the sample charger with its cord cut", credit: "Dmitry G, Wikimedia Commons, public domain" },
  { file: "sample/opened-cord-attached.jpg", recall: "BH-2026-01", what: "the sample charger opened, its cord still attached", credit: "Dmitry G, Wikimedia Commons, public domain" },
  { file: "sample/opened-case.jpg", recall: "BH-2026-01", what: "the sample charger taken apart", credit: "Dmitry G, Wikimedia Commons, public domain" },
  { file: "other/commons-powerbank-oraimo.jpg", recall: null, what: "a look-alike power bank", credit: "Reladex, Wikimedia Commons, CC BY-SA 4.0" },
  { file: "other/commons-powerbank-romoss.jpg", recall: null, what: "a second look-alike power bank", credit: "Shwangtianyuan, Wikimedia Commons, CC BY-SA 4.0" },
  { file: "other/commons-coffee-in-a-mug.jpg", recall: null, what: "a mug of coffee", credit: "Kurt Kaiser, Wikimedia Commons, CC0 1.0" },
  { file: "official/26125-hair-dryer-cord-cut.png", recall: "26125", what: "the CPSC's example: the hair dryer with its cord cut", credit: "U.S. Consumer Product Safety Commission, recall 26125, public domain" },
  { file: "official/25007-droyd-4-straps-cut.jpg", recall: "25007", what: "the CPSC's example: the helmet with its straps cut", credit: "U.S. Consumer Product Safety Commission, recall 25007, public domain" },
  { file: "official/25007-droyd-5-in-trash.jpg", recall: "25007", what: "the CPSC's example: the helmet in the trash", credit: "U.S. Consumer Product Safety Commission, recall 25007, public domain" },
];

export type Variant = { kind: string; label: string; parameters: string; make: (src: Buffer) => Promise<Buffer> };

/** A phone screenshot of the photo: the picture fit to the screen's width on a white screen with a dark bar above and below. */
async function screenshot(src: Buffer): Promise<Buffer> {
  const W = 1170;
  const H = 2532;
  const BAR = 24;
  const photo = await sharp(src).rotate().resize({ width: W, height: H - 2 * BAR, fit: "inside" }).png().toBuffer();
  const m = await sharp(photo).metadata();
  const top = Math.round((H - (m.height ?? 0)) / 2);
  const bar = { create: { width: W, height: BAR, channels: 3 as const, background: "#111111" } };
  return sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite([
      { input: photo, top, left: 0 },
      { input: await sharp(bar).png().toBuffer(), top: 0, left: 0 },
      { input: await sharp(bar).png().toBuffer(), top: H - BAR, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function cropped(src: Buffer, share: number): Promise<Buffer> {
  const img = sharp(src).rotate();
  const m = await img.metadata();
  const w = m.width ?? 0;
  const h = m.height ?? 0;
  const dx = Math.round(w * share);
  const dy = Math.round(h * share);
  return img.extract({ left: dx, top: dy, width: w - 2 * dx, height: h - 2 * dy }).jpeg({ quality: 90 }).toBuffer();
}

const jpeg = (q: number) => (src: Buffer) => sharp(src).rotate().jpeg({ quality: q }).toBuffer();
const resized = (share: number) => async (src: Buffer) => {
  const m = await sharp(src).rotate().metadata();
  return sharp(src).rotate().resize({ width: Math.max(1, Math.round((m.width ?? 0) * share)) }).jpeg({ quality: 90 }).toBuffer();
};
const turned = (deg: number) => (src: Buffer) => sharp(src).rotate().rotate(deg, { background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
const brightness = (factor: number) => (src: Buffer) => sharp(src).rotate().modulate({ brightness: factor }).jpeg({ quality: 90 }).toBuffer();

/** The copies a reuser makes, in the order they are shown. */
export const VARIANTS: Variant[] = [
  { kind: "jpeg-85", label: "Saved again as JPEG", parameters: "quality 85", make: jpeg(85) },
  { kind: "jpeg-60", label: "Saved again as JPEG", parameters: "quality 60", make: jpeg(60) },
  { kind: "jpeg-35", label: "Saved again as JPEG", parameters: "quality 35", make: jpeg(35) },
  { kind: "resize-50", label: "Resized", parameters: "half the width", make: resized(0.5) },
  { kind: "resize-25", label: "Resized", parameters: "a quarter of the width", make: resized(0.25) },
  { kind: "crop-4", label: "Cropped", parameters: "4 percent off every edge", make: (s) => cropped(s, 0.04) },
  { kind: "crop-10", label: "Cropped", parameters: "10 percent off every edge", make: (s) => cropped(s, 0.1) },
  { kind: "rotate-2", label: "Turned", parameters: "2 degrees, white fill", make: turned(2) },
  { kind: "rotate-5", label: "Turned", parameters: "5 degrees, white fill", make: turned(5) },
  { kind: "bright-115", label: "Brightened", parameters: "15 percent lighter", make: brightness(1.15) },
  { kind: "bright-85", label: "Darkened", parameters: "15 percent darker", make: brightness(0.85) },
  { kind: "screenshot", label: "Phone screenshot", parameters: "fit to 1170 px on a 1170 by 2532 screen, 24 px bars", make: screenshot },
  { kind: "mirror", label: "Mirrored", parameters: "flipped left to right", make: (s) => sharp(s).rotate().flop().jpeg({ quality: 90 }).toBuffer() },
];

export type Row = {
  source: string;
  kind: string;
  /** Bits between the copy (any orientation) and the source's stored upright hash. */
  distance: number;
  orientation: string | null;
  caught10: boolean;
  caught4: boolean;
  /** The nearest picture the copy is not a copy of: another source photo, or a published picture of a different recall. */
  nearestUnrelated: { ref: string; distance: number; where: "source" | "catalog" };
  /** The second hash: the nearest framing of the copy to the source's stored center hash, and which framing it was. */
  phashDistance: number;
  phashFraming: string | null;
  /** The second hash's nearest picture the copy is not a copy of, over the same unrelated pictures. */
  nearestUnrelatedPhash: { ref: string; distance: number; where: "source" | "catalog" };
};

/** At one threshold: copies caught and copies within it of an unrelated picture, for each hash and for either. */
export type AtThreshold = { bits: number; dhash: { caught: number; unrelated: number }; phash: { caught: number; unrelated: number }; either: { caught: number; unrelated: number } };

/** The thresholds the comparison is reported at: the dHash's two (4 and 10 bits) and the steps around them. */
export const COMPARE_AT = [4, 6, 8, 10, 12];

export type KindCount = { kind: string; label: string; parameters: string; n: number; caught10: number; caught4: number; medianDistance: number; maxDistance: number };

export type Run = {
  note: string;
  recordedAt: string;
  thresholds: { sameRecall: number; otherRecalls: number };
  sources: { file: string; recall: string | null; what: string; credit: string; dhash: string; phash: string }[];
  variants: { kind: string; label: string; parameters: string }[];
  byKind: KindCount[];
  totals: { n: number; caught10: number; caught4: number; medianDistance: number; maxDistance: number };
  falseMatches: { of: number; within10: number; within4: number; nearestUnrelatedMin: number; unrelatedRefs: { sources: number; catalog: number } };
  /** The second hash beside the dHash: its threshold, its framings, and the comparison at each threshold. */
  phash: {
    region: number;
    maxDistance: number;
    framings: string[];
    catalogPictures: number;
    nearestUnrelatedMin: number;
    byThreshold: AtThreshold[];
    /** At the thresholds in use: the dHash at 4 bits across firms, the new hash at PHASH_MAX_DISTANCE, and either. */
    inUse: { dhashBits: number; phashBits: number; dhash: { caught: number; unrelated: number }; phash: { caught: number; unrelated: number }; either: { caught: number; unrelated: number } };
    byKind: { kind: string; n: number; dhash4: number; phash: number; either: number }[];
  };
  rows: Row[];
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};

/** The measurement itself, shared with the test. */
export async function measure(): Promise<Omit<Run, "note" | "recordedAt">> {
  const bytes = SOURCES.map((s) => readFileSync(path.join(FIXTURES_DIR, s.file)));
  const stored = await Promise.all(bytes.map((b) => photoHashes(b)));
  const storedP = await Promise.all(bytes.map(async (b) => phashGrey(await decodeHashGrey(b))));
  const sources = SOURCES.map((s, i) => ({ ...s, dhash: stored[i].dhash, phash: storedP[i] }));
  const catalog = catalogOfficialHashes();
  const pcat = storedPhashes();
  const rows: Row[] = [];
  let unrelatedCatalog = 0;
  let framingNames: string[] = [];
  for (let i = 0; i < SOURCES.length; i++) {
    const s = SOURCES[i];
    const self = [{ ref: s.file, dhash: stored[i].dhash }];
    const otherSources = sources.filter((_, j) => j !== i).map((o) => ({ ref: o.file, dhash: o.dhash }));
    const otherRecalls = catalog.filter((c) => c.recall !== s.recall).map((c) => ({ ref: c.ref, dhash: c.dhash }));
    // The same unrelated pictures, by their second hash.
    const otherP = [...sources.filter((_, j) => j !== i).map((o) => ({ ref: o.file, phash: o.phash, where: "source" as const })), ...catalog.filter((c) => c.recall !== s.recall && pcat[c.ref]).map((c) => ({ ref: c.ref, phash: pcat[c.ref], where: "catalog" as const }))];
    if (i === 0) unrelatedCatalog = otherRecalls.length;
    for (const v of VARIANTS) {
      const copy = await v.make(bytes[i]);
      const { variants } = await photoHashes(copy);
      const framed = phashFramings(await decodeHashGrey(copy));
      if (!framingNames.length) framingNames = framed.map((f) => f.name);
      const m = closestMatch(variants, self, 64);
      const distance = m?.distance ?? 65;
      const nearSource = nearestDistances(variants, otherSources)[0];
      const nearCatalog = nearestDistances(variants, otherRecalls)[0];
      const nearest = nearSource.distance <= nearCatalog.distance ? { ref: nearSource.ref, distance: nearSource.distance, where: "source" as const } : { ref: nearCatalog.ref, distance: nearCatalog.distance, where: "catalog" as const };
      const p = phashDistance(framed, storedP[i]);
      let nearP = { ref: "", distance: 65, where: "source" as "source" | "catalog" };
      for (const o of otherP) {
        const d = Math.min(...framed.map((f) => hamming(f.phash, o.phash)));
        if (d < nearP.distance) nearP = { ref: o.ref, distance: d, where: o.where };
      }
      rows.push({
        source: s.file,
        kind: v.kind,
        distance,
        orientation: m?.orientation ?? null,
        caught10: Boolean(closestMatch(variants, self, DUPLICATE_MAX_DISTANCE)),
        caught4: Boolean(closestMatch(variants, self, CATALOG_MAX_DISTANCE)),
        nearestUnrelated: nearest,
        phashDistance: p.distance,
        phashFraming: p.framing,
        nearestUnrelatedPhash: nearP,
      });
    }
  }
  const at = (bits: number): AtThreshold => ({
    bits,
    dhash: { caught: rows.filter((r) => r.distance <= bits).length, unrelated: rows.filter((r) => r.nearestUnrelated.distance <= bits).length },
    phash: { caught: rows.filter((r) => r.phashDistance <= bits).length, unrelated: rows.filter((r) => r.nearestUnrelatedPhash.distance <= bits).length },
    either: { caught: rows.filter((r) => r.distance <= bits || r.phashDistance <= bits).length, unrelated: rows.filter((r) => r.nearestUnrelated.distance <= bits || r.nearestUnrelatedPhash.distance <= bits).length },
  });
  const inUseCaught = (r: Row) => r.distance <= CATALOG_MAX_DISTANCE || r.phashDistance <= PHASH_MAX_DISTANCE;
  const count = (list: Row[]) => ({ n: list.length, caught10: list.filter((r) => r.caught10).length, caught4: list.filter((r) => r.caught4).length, medianDistance: median(list.map((r) => r.distance)), maxDistance: Math.max(...list.map((r) => r.distance)) });
  const byKind = VARIANTS.map((v) => ({ kind: v.kind, label: v.label, parameters: v.parameters, ...count(rows.filter((r) => r.kind === v.kind)) }));
  return {
    thresholds: { sameRecall: DUPLICATE_MAX_DISTANCE, otherRecalls: CATALOG_MAX_DISTANCE },
    sources,
    variants: VARIANTS.map(({ kind, label, parameters }) => ({ kind, label, parameters })),
    byKind,
    totals: count(rows),
    falseMatches: {
      of: rows.length,
      within10: rows.filter((r) => r.nearestUnrelated.distance <= DUPLICATE_MAX_DISTANCE).length,
      within4: rows.filter((r) => r.nearestUnrelated.distance <= CATALOG_MAX_DISTANCE).length,
      nearestUnrelatedMin: Math.min(...rows.map((r) => r.nearestUnrelated.distance)),
      unrelatedRefs: { sources: SOURCES.length - 1, catalog: unrelatedCatalog },
    },
    phash: {
      region: PHASH_REGION,
      maxDistance: PHASH_MAX_DISTANCE,
      framings: framingNames,
      catalogPictures: unrelatedCatalog,
      nearestUnrelatedMin: Math.min(...rows.map((r) => r.nearestUnrelatedPhash.distance)),
      byThreshold: COMPARE_AT.map(at),
      inUse: {
        dhashBits: CATALOG_MAX_DISTANCE,
        phashBits: PHASH_MAX_DISTANCE,
        dhash: { caught: rows.filter((r) => r.distance <= CATALOG_MAX_DISTANCE).length, unrelated: rows.filter((r) => r.nearestUnrelated.distance <= CATALOG_MAX_DISTANCE).length },
        phash: { caught: rows.filter((r) => r.phashDistance <= PHASH_MAX_DISTANCE).length, unrelated: rows.filter((r) => r.nearestUnrelatedPhash.distance <= PHASH_MAX_DISTANCE).length },
        either: { caught: rows.filter(inUseCaught).length, unrelated: rows.filter((r) => r.nearestUnrelated.distance <= CATALOG_MAX_DISTANCE || r.nearestUnrelatedPhash.distance <= PHASH_MAX_DISTANCE).length },
      },
      byKind: VARIANTS.map((v) => {
        const list = rows.filter((r) => r.kind === v.kind);
        return { kind: v.kind, n: list.length, dhash4: list.filter((r) => r.caught4).length, phash: list.filter((r) => r.phashDistance <= PHASH_MAX_DISTANCE).length, either: list.filter(inUseCaught).length };
      }),
    },
    rows,
  };
}

async function main() {
  const m = await measure();
  const out: Run = {
    note: `What the hash pool catches on a reused photo, measured in code on ${SOURCES.length} photos from content/verify/fixtures, each put through ${VARIANTS.length} changes a reuser makes (saved again, resized, cropped, turned, brightened, screenshotted, mirrored): how many of the ${m.totals.n} copies the two thresholds catch against the source photo's stored hash, and how many copies come within those thresholds of a picture they are not a copy of (the other source photos, and every other recall's distinct published pictures). It measures these photos and these changes; recorded by scripts/public/hash-reuse-run.ts with no model call, no network and no database, and derived again by tests/hash-reuse-run.test.ts.`,
    recordedAt: new Date().toISOString(),
    ...m,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`hash reuse: ${m.totals.caught10} of ${m.totals.n} copies caught at ${m.thresholds.sameRecall} bits, ${m.totals.caught4} at ${m.thresholds.otherRecalls}; unrelated within ${m.thresholds.sameRecall}: ${m.falseMatches.within10}, within ${m.thresholds.otherRecalls}: ${m.falseMatches.within4}; nearest unrelated ${m.falseMatches.nearestUnrelatedMin} bits`);
  console.table(m.byKind.map((k) => ({ kind: k.kind, caught10: `${k.caught10}/${k.n}`, caught4: `${k.caught4}/${k.n}`, median: k.medianDistance, max: k.maxDistance })));
  console.table(m.phash.byThreshold.map((t) => ({ bits: t.bits, dhash: `${t.dhash.caught} (${t.dhash.unrelated} unrelated)`, phash: `${t.phash.caught} (${t.phash.unrelated} unrelated)`, either: `${t.either.caught} (${t.either.unrelated} unrelated)` })));
  console.table(m.phash.byKind);
  console.log(`second hash: nearest unrelated ${m.phash.nearestUnrelatedMin} bits; in use (dHash ${m.phash.inUse.dhashBits}, new ${m.phash.inUse.phashBits}): either catches ${m.phash.inUse.either.caught} of ${m.totals.n}, unrelated ${m.phash.inUse.either.unrelated}`);
}

if (process.argv[1] && /hash-reuse-run\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
