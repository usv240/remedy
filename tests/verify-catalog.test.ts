import { readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { verifyPhoto } from "@/lib/verify";
import { CATALOG_MAX_DISTANCE, catalogOfficialHashes, DUPLICATE_MAX_DISTANCE, hamming, otherRecallMatch, photoHashes } from "@/lib/verify/dhash";
import { FIXTURES_DIR, fixtureFile, loadFixtureRecalls } from "@/lib/verify/fixtures";

const recalls = loadFixtureRecalls();
const noModel = () => ({
  aiAvailable: () => false,
  cache: null,
  vision: vi.fn(async () => {
    throw new Error("vision must not be called");
  }),
});

describe("the match against every recall's published pictures", () => {
  it("is stricter than the claimed recall's own match", () => {
    expect(CATALOG_MAX_DISTANCE).toBe(4);
    expect(CATALOG_MAX_DISTANCE).toBeLessThan(DUPLICATE_MAX_DISTANCE);
  });

  it("keeps only pictures that are distinct across recalls", () => {
    const c = catalogOfficialHashes();
    expect(c.length).toBeGreaterThan(1500);
    for (let i = 0; i < c.length; i += 7) {
      for (const b of c) if (b.recall !== c[i].recall) expect(hamming(c[i].dhash, b.dhash)).toBeGreaterThan(CATALOG_MAX_DISTANCE);
    }
  });

  it("answers another recall's picture in code, with no model call, and asks for the owner's own photo", async () => {
    const { recall, rule } = recalls["26754"];
    const deps = noModel();
    const r = await verifyPhoto({ photo: fixtureFile("official/26125-hair-dryer-cord-cut.png"), recall, proofRule: rule }, deps);
    expect(deps.vision).not.toHaveBeenCalled();
    expect(r).toMatchObject({ decision: "retake", decided_by: "own_photo" });
    expect(r.checks.C3.reason_plain).toBe("This picture was published with another recall. Please send a photo of your own product.");
    expect(r.checks.C3.reason_technical).toMatch(/recall 26125's official image/);
  });

  it("still finds it re-saved, halved or turned", async () => {
    const orig = fixtureFile("official/26125-hair-dryer-cord-cut.png");
    for (const copy of [await sharp(orig).jpeg({ quality: 60 }).toBuffer(), await sharp(orig).resize(341).jpeg({ quality: 70 }).toBuffer(), await sharp(orig).rotate(90).jpeg({ quality: 55 }).toBuffer()]) {
      expect(otherRecallMatch((await photoHashes(copy)).variants, "26754")?.recall).toBe("26125");
    }
  });

  it("matches no photo that is not a published picture", async () => {
    const files = [
      ...readdirSync(path.join(FIXTURES_DIR, "other")).map((f) => `other/${f}`),
      ...readdirSync(path.join(FIXTURES_DIR, "sample")).filter((f) => /\.jpe?g$/.test(f)).map((f) => `sample/${f}`),
      "derived/commons-coffee-in-a-mug.blur8.jpg",
      "derived/commons-deskck-lower-monitor.crop.jpg",
    ];
    for (const f of files) expect(otherRecallMatch((await photoHashes(fixtureFile(f))).variants, "27056"), f).toBeNull();
  });

  it("is set aside with the official-image match, to measure the model on CPSC's own pictures", async () => {
    const { recall, rule } = recalls["26754"];
    const r = await verifyPhoto({ photo: fixtureFile("official/26125-hair-dryer-cord-cut.png"), recall, proofRule: rule, options: { officialHashCheck: false } }, noModel());
    expect(r.decided_by).not.toBe("own_photo");
  });
});

describe("a photo already sent with a claim on another recall", () => {
  it("goes to a person at the firm, and names neither the other photo nor its recall", async () => {
    const { recall, rule } = recalls["27056"];
    const photo = fixtureFile("other/commons-powerbank-romoss.jpg");
    const { dhash } = await photoHashes(await sharp(photo).jpeg({ quality: 70 }).toBuffer());
    const vision = vi.fn(async () => {
      throw new Error("no model in this test");
    });
    const r = await verifyPhoto({ photo, recall, proofRule: rule, elsewhereHashes: [{ ref: "photo-from-another-firm", dhash }] }, { aiAvailable: () => true, cache: null, vision });
    expect(r.checks.C3.status).toBe("fail");
    expect(r.checks.C3.reason_plain).toBe("This photo matches one sent with a claim on another recall, so a person at the firm will take a look.");
    expect(r.checks.C3.reason_technical).not.toMatch(/photo-from-another-firm/);
    expect(r.decision).toBe("firm_review");
  });

  it("is not matched at the looser distance used within one recall", async () => {
    const { recall, rule } = recalls["27056"];
    const photo = fixtureFile("other/commons-powerbank-romoss.jpg");
    const { dhash } = await photoHashes(photo);
    // Flip 6 bits: within DUPLICATE_MAX_DISTANCE, beyond CATALOG_MAX_DISTANCE.
    const far = dhash.slice(0, 14) + (parseInt(dhash.slice(14), 16) ^ 0x3f).toString(16).padStart(2, "0");
    const r = await verifyPhoto({ photo, recall, proofRule: rule, elsewhereHashes: [{ ref: "x", dhash: far }] }, noModel());
    expect(r.checks.C3.reason_plain).not.toMatch(/another recall/);
  });
});
