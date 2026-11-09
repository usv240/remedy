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
const run = JSON.parse(read("content", "public", "hash-reuse-run.json")) as {
  totals: { n: number; caught4: number; caught10: number };
  falseMatches: { within4: number };
  thresholds: { sameRecall: number; otherRecalls: number };
  sources: unknown[];
  phash: { inUse: { either: { caught: number; unrelated: number } } };
};

describe("the hash pool's measured limits and lineage", () => {
  it("the figures come from the reuse run", () => {
    const p = poolLimits();
    expect([p.caught4, p.caught10, p.n, p.falseWithin4]).toEqual([run.totals.caught4, run.totals.caught10, run.totals.n, run.falseMatches.within4]);
    expect(p.sentence).toContain(`the difference hash alone catches ${run.totals.caught4} at its ${run.thresholds.otherRecalls}-bit threshold across firms (${run.totals.caught10} at ${run.thresholds.sameRecall} bits), with ${run.falseMatches.within4} unrelated matches`);
    // The two hashes together lead, as the claim route uses them; the difference hash alone comes second.
    expect(p.sentence).toContain(`the two hashes together catch ${run.phash.inUse.either.caught} of ${run.totals.n} across firms, with ${run.phash.inUse.either.unrelated} unrelated matches`);
    expect(p.sentence.indexOf(`${run.phash.inUse.either.caught} of ${run.totals.n}`)).toBeLessThan(p.sentence.indexOf(`catches ${run.totals.caught4} at`));
    expect(p.either).toBe(run.phash.inUse.either.caught);
  });

  it("the README's first idea states them before anything else about the pool's speed, with the lineage", () => {
    const first = README.slice(README.indexOf("1. **Each firm that joins makes every other firm safer.**"), README.indexOf("2. **"));
    const limits = poolLimits().sentence.replace(/\.$/, "");
    expect(first).toContain(limits);
    // Every place in the README and docs/results.md that gives both, gives the two-hash figure first.
    const t = run.totals;
    for (const doc of [README, read("docs", "results.md")]) {
      const both = doc.indexOf(`${run.phash.inUse.either.caught} of ${t.n}`);
      const alone = Math.max(doc.indexOf(`${t.caught4} of ${t.n}`), doc.indexOf(`catches ${t.caught4} at`));
      expect(both).toBeGreaterThan(-1);
      expect(alone).toBeGreaterThan(both);
    }
    expect(first.indexOf(limits)).toBeLessThan(first.indexOf("The hash comparison itself"));
    for (const src of [HASH_LINEAGE.photoDna, HASH_LINEAGE.stopNcii]) {
      expect(first).toContain(`[${src.name}](${src.url})`);
    }
    expect(first).toContain("shares only two 64-bit hashes and a row id");
    // The second hash's figures, from the same run, in the same idea.
    expect(first).toContain(poolLimits().second.replace(/\.$/, ""));
    expect(first).toContain("open code");
  });

  it("/evidence shows them beside the two-firm run", () => {
    const page = read("src", "app", "evidence", "page.tsx");
    expect(page).toMatch(/<Network \/>\s+<DocketReplay \/>\s+<PoolLimits \/>/);
    expect(page).toContain("poolLimits().sentence");
    const comp = read("src", "components", "evidence", "PoolLimits.tsx");
    for (const k of ["L.photoDna.url", "L.stopNcii.url", "L.differs"]) expect(comp).toContain(k);
  });
});
