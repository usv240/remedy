import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fixtureFile } from "@/lib/verify/fixtures";
import { decodeImage, sniffMime } from "@/lib/verify/image";
import { assessQuality, QUALITY_LIMITS, qualityGuidance } from "@/lib/verify/quality";

// The quality precheck runs before any model call: variance of the Laplacian for blur, plus light and size.

const q = async (b: Buffer) => {
  const img = await decodeImage(b);
  return assessQuality(img.qualityGrey, img);
};
const mug = fixtureFile("other/commons-coffee-in-a-mug.jpg");

describe("quality precheck", () => {
  it("passes a sharp, well lit phone photo", async () => {
    const r = await q(mug);
    expect(r.ok).toBe(true);
    expect(r.metrics.sharpness).toBeGreaterThan(QUALITY_LIMITS.minSharpness * 2);
  });

  it("passes sharp official images that are mostly plain background", async () => {
    for (const f of ["official/27054-dreo-1.png", "official/27054-dreo-2.jpg", "official/27045-qzhduao-1.png"]) {
      const r = await q(fixtureFile(f));
      expect(r.issues, f).not.toContain("blurry");
    }
  });

  it("flags the blurred fixture as blurry, with friendly guidance", async () => {
    const r = await q(fixtureFile("derived/commons-coffee-in-a-mug.blur8.jpg"));
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(["blurry"]);
    expect(r.metrics.sharpness).toBeLessThan(10);
    const g = qualityGuidance(r);
    expect(g.plain).toBe("The photo is a bit blurry. Please take it again.");
    expect(g.steps).toEqual(["Hold the phone still and tap the screen on the product to focus."]);
  });

  it("scores sharpness down as blur goes up", async () => {
    const s = await Promise.all([0, 1, 3, 6].map(async (sigma) => (await q(sigma ? await sharp(mug).blur(sigma).jpeg().toBuffer() : mug)).metrics.sharpness));
    expect(s).toEqual([...s].sort((a, b) => b - a));
  });

  it("flags a dark photo as dark, not blurry", async () => {
    const dark = await sharp(mug).modulate({ brightness: 0.25 }).jpeg().toBuffer();
    const r = await q(dark);
    expect(r.issues).toContain("dark");
    expect(r.issues).not.toContain("blurry");
    expect(qualityGuidance(r).plain).toBe("The photo is a bit dark. Please take it again.");
  });

  it("flags a washed-out photo and a tiny one", async () => {
    const bright = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#fbfbfb" } }).jpeg().toBuffer();
    expect((await q(bright)).issues).toContain("bright");
    const tiny = await sharp(mug).resize(160).jpeg().toBuffer();
    expect((await q(tiny)).issues).toContain("small");
  });

  it("honours EXIF orientation when it reports the size", async () => {
    const rotated = await sharp(mug).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const img = await decodeImage(rotated);
    expect([img.width, img.height]).toEqual([960, 1280]);
  });
});

describe("file type", () => {
  it("sniffs JPEG, PNG and HEIC from the bytes", async () => {
    expect(sniffMime(mug)).toBe("image/jpeg");
    expect(sniffMime(fixtureFile("official/27054-dreo-1.png"))).toBe("image/png");
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(8)]);
    expect(sniffMime(heic)).toBe("image/heic");
  });
});
