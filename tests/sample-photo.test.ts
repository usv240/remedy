import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSamplePhoto, SAMPLE_PHOTO_FILE, samplePhotoSha } from "@/app/api/claims/_lib/sample-photo";

/**
 * Brightline's published sample photo (the charger with its cord cut) can be used by every visitor on the sample shop's
 * recall, so it stays out of the earlier-claims pool. Only that exact file, and only on that recall.
 */
describe("the published sample photo", () => {
  const bytes = readFileSync(path.join(process.cwd(), SAMPLE_PHOTO_FILE));

  it("is the same file the verifier's fixture holds", () => {
    expect(readFileSync(path.join(process.cwd(), "content", "verify", "fixtures", "sample", "cord-cut.jpg")).equals(bytes)).toBe(true);
    expect(samplePhotoSha()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is recognized on the sample recall only, and only as the exact file", () => {
    expect(isSamplePhoto("BH-2026-01", bytes)).toBe(true);
    expect(isSamplePhoto("27056", bytes)).toBe(false);
    const changed = Buffer.from(bytes);
    changed[changed.length - 3] ^= 0xff;
    expect(isSamplePhoto("BH-2026-01", changed)).toBe(false);
    expect(isSamplePhoto("BH-2026-01", readFileSync(path.join(process.cwd(), "content", "verify", "fixtures", "sample", "opened-case.jpg")))).toBe(false);
  });
});
