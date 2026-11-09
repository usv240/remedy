import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_MAX_DISTANCE, DUPLICATE_MAX_DISTANCE } from "@/lib/verify/dhash";
import { measure, SOURCES, VARIANTS, type Run } from "../scripts/public/hash-reuse-run";

/**
 * The hash pool against a reused photo (content/public/hash-reuse-run.json, written by scripts/public/hash-reuse-run.ts):
 * the same copies are made again here with sharp and hashed the way a claim photo is, and the file's counts must come out
 * the same. Counts and thresholds match exactly. Each distance is allowed one bit of play, because libvips can round a
 * resize or a rotation differently from one platform build to another; on the machine that wrote the file they are equal.
 */
const run = JSON.parse(readFileSync(path.join(process.cwd(), "content", "public", "hash-reuse-run.json"), "utf8")) as Run;

describe("the hash pool against a reused photo (content/public/hash-reuse-run.json)", () => {
  it("records every source photo, every change, and the two thresholds the claim route uses", () => {
    expect(run.thresholds).toEqual({ sameRecall: DUPLICATE_MAX_DISTANCE, otherRecalls: CATALOG_MAX_DISTANCE });
    expect(run.sources.map((s) => s.file)).toEqual(SOURCES.map((s) => s.file));
    expect(run.variants.map((v) => v.kind)).toEqual(VARIANTS.map((v) => v.kind));
    expect(run.rows).toHaveLength(SOURCES.length * VARIANTS.length);
    expect(run.totals.n).toBe(run.rows.length);
    expect(run.falseMatches.of).toBe(run.rows.length);
    for (const s of run.sources) expect(s.credit, s.file).toMatch(/Wikimedia Commons|Consumer Product Safety Commission/);
    expect(run.note).toMatch(/measured in code/);
  });

  it("the counts in the file follow from its own rows", () => {
    const rows = run.rows;
    expect(run.totals.caught10).toBe(rows.filter((r) => r.caught10).length);
    expect(run.totals.caught4).toBe(rows.filter((r) => r.caught4).length);
    for (const r of rows) {
      expect(r.caught10, `${r.source} ${r.kind}`).toBe(r.distance <= DUPLICATE_MAX_DISTANCE);
      expect(r.caught4, `${r.source} ${r.kind}`).toBe(r.distance <= CATALOG_MAX_DISTANCE);
    }
    for (const k of run.byKind) {
      const mine = rows.filter((r) => r.kind === k.kind);
      expect(k.n).toBe(mine.length);
      expect(k.caught10).toBe(mine.filter((r) => r.caught10).length);
      expect(k.caught4).toBe(mine.filter((r) => r.caught4).length);
      expect(k.maxDistance).toBe(Math.max(...mine.map((r) => r.distance)));
    }
    expect(run.falseMatches.within10).toBe(rows.filter((r) => r.nearestUnrelated.distance <= DUPLICATE_MAX_DISTANCE).length);
    expect(run.falseMatches.within4).toBe(rows.filter((r) => r.nearestUnrelated.distance <= CATALOG_MAX_DISTANCE).length);
    expect(run.falseMatches.nearestUnrelatedMin).toBe(Math.min(...rows.map((r) => r.nearestUnrelated.distance)));
    // A copy that lands within the cross-recall threshold of a picture it is not a copy of would be a wrong hold.
    expect(run.falseMatches.within4).toBe(0);
  });

  it("comes out the same when the copies are made and hashed again", { timeout: 120_000 }, async () => {
    const again = await measure();
    expect(again.sources.map((s) => s.dhash)).toEqual(run.sources.map((s) => s.dhash));
    expect(again.totals).toEqual(run.totals);
    expect(again.falseMatches).toEqual(run.falseMatches);
    expect(again.byKind.map((k) => [k.kind, k.n, k.caught10, k.caught4])).toEqual(run.byKind.map((k) => [k.kind, k.n, k.caught10, k.caught4]));
    expect(again.rows).toHaveLength(run.rows.length);
    for (let i = 0; i < run.rows.length; i++) {
      const a = again.rows[i];
      const b = run.rows[i];
      expect([a.source, a.kind]).toEqual([b.source, b.kind]);
      expect(Math.abs(a.distance - b.distance), `${b.source} ${b.kind}: distance`).toBeLessThanOrEqual(1);
      expect(Math.abs(a.nearestUnrelated.distance - b.nearestUnrelated.distance), `${b.source} ${b.kind}: nearest unrelated`).toBeLessThanOrEqual(1);
    }
  });
});
