import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, describe, expect, it, vi } from "vitest";
import { decide, verifyPhoto, type VerifyInput } from "@/lib/verify";
import { PERSON_PLAIN } from "@/lib/verify/decide";
import { fixtureFile, loadFixtureRecalls } from "@/lib/verify/fixtures";
import type { VisionRun } from "@/lib/verify/vision";
import { personInPhoto, type VisionReport } from "@/lib/verify/vision-schema";
import { ORIGINAL_KEEP_HOURS, PHOTO_KEEP_DAYS, retentionCutoff, storedCopy } from "@/lib/ops/photos";

// A person in the photo, and how long photos are kept: the decision path with the vision step stubbed (no network),
// the stored copy's metadata, and, with DATABASE_URL, the deletion and the 90-day prune on the real tables.

const { recall, rule } = loadFixtureRecalls()["27056"];
const photo = fixtureFile("other/commons-coffee-in-a-mug.jpg");

function report(over: Partial<VisionReport> = {}): VisionReport {
  return {
    scene: "A black power bank with RECALLED written on the front, held up by a person.",
    product: { match_score: 0.93, matching_details: ["20W printed on the front"], differing_details: [], reason_plain: "Same case.", reason_technical: "Shape and print match image 1." },
    actions: [{ action: "write_recalled", done: true, confidence: 0.95, evidence: "RECALLED across the front" }],
    handwritten_text: [{ text: "RECALLED", on_product: true, where: "front" }],
    identifiers: { model_text: null, lot_text: null, date_code_text: null, label_visible: false, where: null },
    photo_source: { kind: "camera_photo", signs: ["none"], confidence: 0.9, reason: "Camera noise." },
    retake_tip: "",
    person: { visible: false, kinds: [], where: "" },
    ...over,
  };
}
const visionOf = (r: VisionReport | Omit<VisionReport, "person">) =>
  vi.fn(async (): Promise<VisionRun> => ({ report: r as VisionReport, model: "claude-opus-5-5", ms: 1, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
const input = (): VerifyInput => ({ photo, mime: "image/jpeg", recall, proofRule: rule, claimContext: { firmAmount: { value: "20.00", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } } });
const live = { aiAvailable: () => true, cache: null };

describe("a person in the photo", () => {
  it("is a retake before anything else, even when every check passes", () => {
    const quality = { ok: true, issues: [], metrics: { width: 1, height: 1, sharpness: 1, laplacianVariance: 1, meanLuma: 1, p95Luma: 1, p05Luma: 1 } };
    const pass = { pass: true, status: "pass" as const, name: "", reason_plain: "", reason_technical: "" };
    const checks = Object.fromEntries((["C1", "C2", "C3", "C4", "C5", "C6"] as const).map((id) => [id, { ...pass, id }])) as Parameters<typeof decide>[0]["checks"];
    const amount = { amount: null, overCap: false, missing: false, cap: null, technical: "" } as unknown as Parameters<typeof decide>[0]["amount"];
    expect(decide({ quality, checks, ownPhoto: null, amount }).decision).toBe("verified");
    expect(decide({ quality, checks, ownPhoto: null, amount, personVisible: true })).toMatchObject({ decision: "retake", decided_by: "person" });
  });

  it("asks for a photo with only the product in it, and calls no reviewer", async () => {
    const reviewers = vi.fn();
    const r = await verifyPhoto(input(), { ...live, vision: visionOf(report({ person: { visible: true, kinds: ["face", "body"], where: "a man holding it up, left half" } })), reviewers });
    expect(r.decision).toBe("retake");
    expect(r.decided_by).toBe("person");
    expect(r.person).toEqual({ visible: true, kinds: ["face", "body"] });
    expect(r.guidance?.plain).toBe(PERSON_PLAIN);
    expect(r.summary.plain).toBe(PERSON_PLAIN);
    expect(r.guidance?.steps.join(" ")).toContain("deleted at once");
    expect(r.summary.technical).toContain("Person in the photo (face, body");
    expect(reviewers).not.toHaveBeenCalled();
  });

  it("does not count hands holding the product", async () => {
    const r = await verifyPhoto(input(), { ...live, vision: visionOf(report({ person: { visible: false, kinds: [], where: "" } })) });
    expect(r.decision).toBe("verified");
    expect(r.person).toBeNull();
  });

  it("reads an answer recorded before the field existed as no person", async () => {
    const { person: _drop, ...old } = report();
    void _drop;
    expect(personInPhoto(old as VisionReport)).toBeNull();
    const r = await verifyPhoto(input(), { ...live, vision: visionOf(old) });
    expect(r.decision).toBe("verified");
    expect(r.person).toBeNull();
  });
});

describe("the stored copy", () => {
  it("keeps no EXIF or GPS metadata", async () => {
    const tagged = await sharp(photo)
      .withExif({ IFD0: { Make: "RemedyTestCam", Model: "X1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 58/1 56/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const copy = await storedCopy(tagged);
    expect(copy).not.toBeNull();
    const meta = await sharp(copy!.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(copy!.bytes.includes(Buffer.from("RemedyTestCam"))).toBe(false);
    expect(Math.max(copy!.width, copy!.height)).toBeLessThanOrEqual(1600);
  });

  it("keeps no copy of a file it cannot read, so its metadata is never stored", async () => {
    expect(await storedCopy(Buffer.from("not an image at all, just text"))).toBeNull();
  });

  it("keeps photos 90 days after the decision, and an untouched upload a day at most", () => {
    expect(PHOTO_KEEP_DAYS).toBe(90);
    expect(ORIGINAL_KEEP_HOURS).toBe(24);
    const now = new Date("2026-11-07T12:00:00Z");
    expect(retentionCutoff(now).toISOString()).toBe("2026-08-09T12:00:00.000Z");
  });
});

const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("deleting photo bytes in Postgres", async () => {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { prunePhotos, removePhoto } = await import("@/lib/ops/photos");
  const tag = `privacy-test-${randomUUID().slice(0, 8)}`;
  const made: { photos: string[]; claims: string[] } = { photos: [], claims: [] };
  const bytes = Buffer.from("stored copy");

  async function photoRow(source: "upload" | "preset", decidedDaysAgo: number | null) {
    const sha = randomUUID().replace(/-/g, "").padEnd(64, "0");
    const [p] = (await db().execute(sql`insert into photo (sha256, dhash, mime, size, bytes, original, source) values (${sha}, '0123456789abcdef', 'image/jpeg', 11, ${bytes}, ${bytes}, ${source}) returning id`)).rows as { id: string }[];
    made.photos.push(p.id);
    const decided = decidedDaysAgo === null ? null : new Date(Date.now() - decidedDaysAgo * 86_400_000);
    const [c] = (
      await db().execute(sql`insert into claim (recall_number, photo_id, decision, status, is_sample, decided_at, channel) values ('27056', ${p.id}::uuid, 'verified', 'verified', true, ${decided}, 'web') returning id`)
    ).rows as { id: string }[];
    made.claims.push(c.id);
    return { photo: p.id, claim: c.id, sha };
  }
  const read = async (id: string) =>
    ((await db().execute(sql`select bytes is not null as has_bytes, original is not null as has_original, sha256, dhash, removed_reason from photo where id = ${id}::uuid`)).rows[0] as {
      has_bytes: boolean;
      has_original: boolean;
      sha256: string;
      dhash: string;
      removed_reason: string | null;
    });

  afterAll(async () => {
    if (made.claims.length) await db().execute(sql`delete from claim where id = any(${`{${made.claims.join(",")}}`}::uuid[])`);
    if (made.photos.length) await db().execute(sql`delete from photo where id = any(${`{${made.photos.join(",")}}`}::uuid[])`);
  });

  it("deletes a photo that shows a person at once, keeping its hashes, and the ledger line holds no image data", async () => {
    const p = await photoRow("upload", 0);
    expect(await removePhoto(p.photo, "person", `claim:${p.claim}:${tag}`)).toBe(true);
    const row = await read(p.photo);
    expect(row).toMatchObject({ has_bytes: false, has_original: false, sha256: p.sha, dhash: "0123456789abcdef", removed_reason: "person" });
    const [entry] = (await db().execute(sql`select action, detail from audit_event where ref = ${`claim:${p.claim}:${tag}`} order by id desc limit 1`)).rows as { action: string; detail: Record<string, unknown> }[];
    expect(entry.action).toBe("photo.removed");
    expect(Object.keys(entry.detail).sort()).toEqual(["image_data", "photo", "reason"]);
    expect(JSON.stringify(entry.detail)).not.toMatch(/base64|ffd8/i);
    expect(await removePhoto(p.photo, "person", `claim:${p.claim}:${tag}`)).toBe(false);
  });

  it("prunes owners' photos 90 days after the decision, and leaves newer ones and sample pictures", async () => {
    const old = await photoRow("upload", PHOTO_KEEP_DAYS + 1);
    const recent = await photoRow("upload", 10);
    const sample = await photoRow("preset", 400);
    const r = await prunePhotos();
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(await read(old.photo)).toMatchObject({ has_bytes: false, has_original: false, sha256: old.sha, dhash: "0123456789abcdef", removed_reason: "retention" });
    expect(await read(recent.photo)).toMatchObject({ has_bytes: true, removed_reason: null });
    expect(await read(sample.photo)).toMatchObject({ has_bytes: true, removed_reason: null });
  });
});
