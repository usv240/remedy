import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { poolLimits } from "@/components/evidence/PoolLimits";
import { HASH_LINEAGE } from "@/lib/research";

/**
 * The pool's measured limits are stated up front, in the README's first idea and beside the two-firm run on /evidence,
 * from content/public/hash-reuse-run.json, with the hash-list lineage cited to each service's own page.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const README = read("README.md");
const run = JSON.parse(read("content", "public", "hash-reuse-run.json")) as { totals: { n: number; caught4: number; caught10: number }; falseMatches: { within4: number }; thresholds: { sameRecall: number; otherRecalls: number }; sources: unknown[] };

describe("the hash pool's measured limits and lineage", () => {
  it("the figures come from the reuse run", () => {
    const p = poolLimits();
    expect([p.caught4, p.caught10, p.n, p.falseWithin4]).toEqual([run.totals.caught4, run.totals.caught10, run.totals.n, run.falseMatches.within4]);
    expect(p.sentence).toContain(`${run.totals.caught4} of ${run.totals.n} caught at the ${run.thresholds.otherRecalls}-bit threshold used across firms, ${run.totals.caught10} at ${run.thresholds.sameRecall} bits, and ${run.falseMatches.within4} unrelated matches within ${run.thresholds.otherRecalls} bits`);
  });

  it("the README's first idea states them before anything else about the pool's speed, with the lineage", () => {
    const first = README.slice(README.indexOf("1. **Each firm that joins makes every other firm safer.**"), README.indexOf("2. **The refund goes back"));
    const t = run.totals;
    const limits = `Measured on ${t.n} reused copies of ${run.sources.length} photos: ${t.caught4} of ${t.n} caught at the ${run.thresholds.otherRecalls}-bit threshold used across firms, ${t.caught10} at ${run.thresholds.sameRecall} bits, and ${run.falseMatches.within4} unrelated matches within ${run.thresholds.otherRecalls} bits`;
    expect(first).toContain(limits);
    expect(first.indexOf(limits)).toBeLessThan(first.indexOf("The hash comparison itself"));
    for (const src of [HASH_LINEAGE.photoDna, HASH_LINEAGE.stopNcii]) {
      expect(first).toContain(`[${src.name}](${src.url})`);
    }
    expect(first).toContain("shares only a 64-bit hash and a row id");
    expect(first).toContain("open code");
  });

  it("/evidence shows them beside the two-firm run", () => {
    const page = read("src", "app", "evidence", "page.tsx");
    expect(page).toMatch(/<Network \/>\s+<PoolLimits \/>/);
    expect(page).toContain("poolLimits().sentence");
    const comp = read("src", "components", "evidence", "PoolLimits.tsx");
    for (const k of ["L.photoDna.url", "L.stopNcii.url", "L.differs"]) expect(comp).toContain(k);
  });
});
