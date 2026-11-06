import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { SAME_PICTURE_MAX_DISTANCE, dhash, dhashRotations, hamming, isSamePicture, nearest } from "@/lib/recall/dhash";

/** A synthetic "photo": a gradient with shapes, rendered by sharp, so the test needs no network or fixture file. */
const scene = (variant: 0 | 1) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#${variant ? "203040" : "f4e8d0"}"/><stop offset="1" stop-color="#${variant ? "e0c080" : "304060"}"/></linearGradient></defs>
<rect width="640" height="480" fill="url(#g)"/>
<circle cx="${variant ? 450 : 200}" cy="200" r="120" fill="#c03020"/>
<rect x="${variant ? 60 : 380}" y="260" width="180" height="160" fill="#2060a0"/>
<rect x="300" y="40" width="40" height="400" fill="#f0f0f0"/>
<circle cx="560" cy="${variant ? 400 : 90}" r="50" fill="#20a060"/>
</svg>`);

const real = (p: string) => {
  const f = path.join(process.cwd(), "public", "recalls", p);
  return existsSync(f) ? readFileSync(f) : null;
};

const variants = async (img: Buffer) => {
  const { width: W = 0, height: H = 0 } = await sharp(img).metadata();
  const crop = (f: number) => sharp(img).extract({ left: Math.round(W * f), top: Math.round(H * f), width: Math.round(W * (1 - 2 * f)), height: Math.round(H * (1 - 2 * f)) }).toBuffer();
  return {
    identical: Buffer.from(img),
    recompressed: await sharp(img).jpeg({ quality: 30 }).toBuffer(),
    resized: await sharp(img).resize(Math.round(W / 2)).png().toBuffer(),
    cropped: await crop(0.03),
    rotated90: await sharp(img).rotate(90).toBuffer(),
    rotated180: await sharp(img).rotate(180).toBuffer(),
    tilted2: await sharp(img).rotate(2, { background: "#ffffff" }).toBuffer(),
  };
};

describe("hamming", () => {
  it("counts differing bits", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hamming("0f00000000000001", "0000000000000000")).toBe(5);
  });
  it("rejects anything that is not 16 hex characters", () => {
    expect(() => hamming("abc", "0000000000000000")).toThrow();
  });
});

for (const [name, load, other] of [
  ["synthetic scene", async () => sharp(scene(0)).jpeg({ quality: 92 }).toBuffer(), async () => sharp(scene(1)).jpeg({ quality: 92 }).toBuffer()],
  ["official CPSC image (26754)", async () => real("26754/2.webp"), async () => real("27056/2.webp")],
] as const) {
  describe(`dHash on a ${name}`, () => {
    let base: Buffer | null = null;
    let h = "";
    let v: Awaited<ReturnType<typeof variants>>;
    let different: Buffer | null = null;
    beforeAll(async () => {
      base = await load();
      if (!base) return;
      h = await dhash(base);
      v = await variants(base);
      different = await other();
    });
    const dist = async (b: Buffer) => hamming(h, await dhash(b));
    const rotDist = async (b: Buffer) => nearest(await dhashRotations(b), [{ ref: "official", dhash: h }]).distance;

    it("is 16 hex characters and stable", async () => {
      if (!base) return;
      expect(h).toMatch(/^[0-9a-f]{16}$/);
      expect(await dhash(base)).toBe(h);
    });
    it("identical copy: distance 0", async () => {
      if (!base) return;
      expect(await dist(v.identical)).toBe(0);
    });
    it("recompressed (JPEG quality 30) and resized to half: same picture", async () => {
      if (!base) return;
      expect(await dist(v.recompressed)).toBeLessThanOrEqual(4);
      expect(await dist(v.resized)).toBeLessThanOrEqual(4);
    });
    it("cropped 3% on every side: same picture", async () => {
      if (!base) return;
      expect(await dist(v.cropped)).toBeLessThanOrEqual(SAME_PICTURE_MAX_DISTANCE);
    });
    it("turned 90 or 180 degrees: far apart plain, matched by the rotation-aware compare", async () => {
      if (!base) return;
      expect(await dist(v.rotated90)).toBeGreaterThan(SAME_PICTURE_MAX_DISTANCE);
      expect(await rotDist(v.rotated90)).toBeLessThanOrEqual(4);
      expect(await rotDist(v.rotated180)).toBeLessThanOrEqual(4);
      expect(isSamePicture(await dhashRotations(v.rotated90), [{ ref: "official", dhash: h }])).toBe(true);
    });
    it("tilted 2 degrees: same picture", async () => {
      if (!base) return;
      expect(await rotDist(v.tilted2)).toBeLessThanOrEqual(SAME_PICTURE_MAX_DISTANCE);
    });
    it("a different picture: not the same picture", async () => {
      if (!base || !different) return;
      expect(await rotDist(different)).toBeGreaterThan(SAME_PICTURE_MAX_DISTANCE);
      expect(isSamePicture(await dhashRotations(different), [{ ref: "official", dhash: h }])).toBe(false);
    });
  });
}

describe("official image hashes file", () => {
  const f = path.join(process.cwd(), "content", "recalls", "image-hashes.json");
  it("maps recall numbers to { url, dhash } lists", () => {
    if (!existsSync(f)) return;
    const data = JSON.parse(readFileSync(f, "utf8")) as Record<string, { url: string; dhash: string }[]>;
    const entries = Object.entries(data);
    expect(entries.length).toBeGreaterThan(400);
    for (const [num, list] of entries.slice(0, 50)) {
      expect(num).toMatch(/^\d{5}$/);
      for (const e of list) {
        expect(e.url).toMatch(/^https:\/\//);
        expect(e.dhash).toMatch(/^[0-9a-f]{16}$/);
      }
    }
  });
});
