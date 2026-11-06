import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { closestMatch, detailBits, dhash, dhashGrey, dhashVariants, hamming, isHash, nearestDistances, photoHashes, storedOfficialHashes } from "@/lib/verify/dhash";
import { dhash as recallDhash } from "@/lib/recall/dhash";
import { fixtureFile } from "@/lib/verify/fixtures";
import { decodeImage } from "@/lib/verify/image";

// Remedy's one dHash (C3): 64 bits, eight orientations, 10 bits or less is the same picture, compared only with the
// claimed recall's own official images and its earlier claim photos.

const OFFICIAL = ["official/27056-haiara-1.jpg", "official/27056-haiara-2.jpg", "official/27056-haiara-3.jpg", "official/27054-dreo-1.png", "official/27054-dreo-2.jpg", "official/27045-qzhduao-1.png"];
const variantsOf = async (rel: string) => dhashVariants((await decodeImage(fixtureFile(rel))).hashGrey);
const refsOf = async (files: string[]) => Promise.all(files.map(async (f) => ({ ref: f, dhash: await dhash(fixtureFile(f)) })));

describe("hamming", () => {
  it("counts differing bits across all 64", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hamming("8000000000000001", "0000000000000000")).toBe(2);
    expect(hamming("00000000ffffffff", "ffffffff00000000")).toBe(64);
    expect(() => hamming("xyz", "0000000000000000")).toThrow();
  });
});

describe("dhash", () => {
  it("is 16 hex characters and stable for the same file", async () => {
    const a = await dhash(fixtureFile(OFFICIAL[0]));
    expect(isHash(a)).toBe(true);
    expect(await dhash(fixtureFile(OFFICIAL[0]))).toBe(a);
  });

  it("is one algorithm: the recall module re-exports it, and the light and shared decodes agree", async () => {
    expect(recallDhash).toBe(dhash);
    for (const f of [...OFFICIAL, "other/commons-coffee-in-a-mug.jpg"]) {
      const img = await decodeImage(fixtureFile(f));
      expect(dhashVariants(img.hashGrey)[0]).toBe(dhashGrey(img.hashGrey));
      expect(await dhash(fixtureFile(f)), f).toBe(dhashGrey(img.hashGrey));
    }
    expect((await photoHashes(fixtureFile(OFFICIAL[3]))).variants).toHaveLength(8);
  });

  it("catches the rotated and recompressed copy of an official image (distance 1 on the fixture)", async () => {
    const m = closestMatch(await variantsOf("derived/27056-haiara-1.rotated90-q55.jpg"), await refsOf(["official/27056-haiara-1.jpg"]));
    expect(m?.ref).toBe("official/27056-haiara-1.jpg");
    expect(m!.distance).toBeLessThanOrEqual(2);
  });

  it("catches the 4 degree tilt with a 6 percent crop, at the edge of the threshold", async () => {
    const m = closestMatch(await variantsOf("derived/27054-dreo-2.tilt4-crop-q60.jpg"), await refsOf(["official/27054-dreo-2.jpg"]));
    expect(m?.ref).toBe("official/27054-dreo-2.jpg");
    expect(m!.distance).toBeLessThanOrEqual(10);
  });

  it("catches a mirrored copy and a resized PNG copy", async () => {
    const src = fixtureFile("official/27054-dreo-1.png");
    const stored = [{ ref: "dreo-1", dhash: await dhash(src) }];
    const mirrored = await sharp(src).flop().jpeg({ quality: 70 }).toBuffer();
    const small = await sharp(src).resize(200).png().toBuffer();
    for (const b of [mirrored, small]) expect(closestMatch(dhashVariants((await decodeImage(b)).hashGrey), stored)).not.toBeNull();
  });

  it("keeps the fixture's different official images apart (every pair more than 10 bits)", async () => {
    const hashes = await refsOf(OFFICIAL);
    for (const h of hashes) expect(closestMatch(await variantsOf(h.ref), hashes.filter((o) => o.ref !== h.ref)), h.ref).toBeNull();
  });

  it("never matches a flat image, which says nothing about where it came from", async () => {
    const white = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const h = await dhash(white);
    expect(detailBits(h)).toBeLessThan(4);
    expect(closestMatch(dhashVariants((await decodeImage(white)).hashGrey), [{ ref: "white", dhash: h }])).toBeNull();
  });
});

const hashesFile = path.join(process.cwd(), "content", "recalls", "image-hashes.json");

describe.skipIf(!existsSync(hashesFile))("stored official hashes and the C3 scope", () => {
  const all = JSON.parse(readFileSync(hashesFile, "utf8")) as Record<string, { url: string; dhash: string }[]>;
  const flat = Object.entries(all).flatMap(([n, imgs]) => imgs.map((i) => ({ n, dhash: i.dhash })));

  it("were written with this dHash (the fixture copies of 27056 hash to the stored values)", async () => {
    const stored = storedOfficialHashes("27056").map((s) => s.dhash);
    for (const f of OFFICIAL.slice(0, 3)) expect(stored, f).toContain(await dhash(fixtureFile(f)));
  });

  it("would collide across recalls if compared with every official image, which is why C3 does not", () => {
    let near = 0;
    for (const a of flat) if (flat.some((b) => b !== a && b.n !== a.n && hamming(a.dhash, b.dhash) <= 10)) near++;
    console.log(`official images within 10 bits of another recall's image: ${near} of ${flat.length}`);
    expect(near).toBeGreaterThan(100);
  });

  it("keeps a genuine photo of another product clear of each demo recall's own images", async () => {
    for (const n of ["27056", "27045", "26125", "25007", "26754"]) {
      expect(closestMatch(await variantsOf("other/commons-coffee-in-a-mug.jpg"), storedOfficialHashes(n)), n).toBeNull();
    }
  });

  it("reports the nearest distances for Technical view", async () => {
    const d = nearestDistances(await variantsOf("official/27056-haiara-2.jpg"), storedOfficialHashes("27056"));
    expect(d[0].distance).toBe(0);
  });
});
