import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkPool, POOL_ANSWER_FIELDS, type PoolRow } from "@/app/api/v1/hash-pool/_lib/pool";
import { dhash } from "@/lib/verify/dhash";
import { FIXTURES_DIR } from "@/lib/verify/fixtures";
import { decodeHashGrey } from "@/lib/verify/image";
import { phash, phashDistance, phashFramings, phashMatch, PHASH_MAX_DISTANCE, storedPhashes } from "@/lib/verify/phash";
import { pictureFiles } from "../scripts/recalls/phashes";

/**
 * The second hash (src/lib/verify/phash.ts): what it is, that the published pictures' stored values are what the code
 * makes from the committed thumbnails, and that it holds a cropped or turned copy the dHash lets go, while staying off a
 * different photo. tests/hash-reuse-run.test.ts measures it on every copy; this checks the pieces.
 */
const fixture = (f: string) => readFileSync(path.join(FIXTURES_DIR, f));
const framedOf = async (b: Buffer) => phashFramings(await decodeHashGrey(b));

describe("the second hash", () => {
  it("is 16 hex characters, the same on every run, and its first framing is the stored one", async () => {
    const b = fixture("sample/cord-cut.jpg");
    const h = await phash(b);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(await phash(b)).toBe(h);
    const framed = await framedOf(b);
    expect(framed[0]).toEqual({ name: "upright center", phash: h });
    expect(framed.length).toBeGreaterThan(8);
  });

  it("the published pictures' stored second hashes are the code's own, read from the committed thumbnails", async () => {
    const stored = storedPhashes();
    const files = pictureFiles();
    expect(Object.keys(stored).length).toBe(files.length);
    // Every 150th picture, and the sample recall's own, hashed again.
    const pick = [...files.filter((_, i) => i % 150 === 0), ...files.filter((f) => f.url.startsWith("/samples/"))];
    for (const p of pick) expect(stored[p.url], p.url).toBe(await phash(readFileSync(p.file)));
  });

  it("holds a copy cropped by a tenth or turned five degrees, which the dHash lets go, and stays off another photo", async () => {
    const src = fixture("sample/cord-cut.jpg");
    const stored = await phash(src);
    const m = await sharp(src).rotate().metadata();
    const dx = Math.round((m.width ?? 0) * 0.1);
    const dy = Math.round((m.height ?? 0) * 0.1);
    const crop = await sharp(src).rotate().extract({ left: dx, top: dy, width: (m.width ?? 0) - 2 * dx, height: (m.height ?? 0) - 2 * dy }).jpeg({ quality: 90 }).toBuffer();
    const turn = await sharp(src).rotate().rotate(5, { background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    for (const copy of [crop, turn]) expect(phashDistance(await framedOf(copy), stored).distance).toBeLessThanOrEqual(PHASH_MAX_DISTANCE);
    const other = await framedOf(fixture("other/commons-coffee-in-a-mug.jpg"));
    expect(phashDistance(other, stored).distance).toBeGreaterThan(PHASH_MAX_DISTANCE);
  });

  it("matches only refs that carry a second hash", async () => {
    const src = fixture("sample/cord-cut.jpg");
    const framed = await framedOf(src);
    const d = await dhash(src);
    expect(phashMatch(framed, [{ ref: "no-second", dhash: d }])).toBeNull();
    expect(phashMatch(framed, [{ ref: "with-second", dhash: d, phash: framed[0].phash }])).toMatchObject({ ref: "with-second", distance: 0 });
  });

  it("the pool answers a second-hash hit on a pool row and says which hash matched; nothing else crosses", async () => {
    const src = fixture("sample/cord-cut.jpg");
    const p = await phash(src);
    // A pool row whose dHash is far from the photo's, but whose second hash is the photo's: a cropped copy registered elsewhere.
    const rows: PoolRow[] = [{ ref: "partner-row", dhash: "0f0f0f0f0f0f0f0f", phash: p, source: "partner", recallNumber: "BH-2026-01" }];
    const r = checkPool(await dhash(src), "FW-2026-01", rows, [], p);
    expect(r).toMatchObject({ hit: true, distance: 0, hash: "phash", ref: "partner-row", source: "partner", threshold_bits: PHASH_MAX_DISTANCE });
    expect(Object.keys(r).sort()).toEqual([...POOL_ANSWER_FIELDS].sort());
    // Without the second hash in the request, the same row is no hit.
    expect(checkPool(await dhash(src), "FW-2026-01", rows, []).hit).toBe(false);
  });
});
