import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { poolLimits } from "@/components/evidence/PoolLimits";
import { HASH_LINEAGE } from "@/lib/research";

/**
 * The pool's measured limits are stated in one place, in docs/results.md ("The pool, in short") and beside the two-firm
 * run on /evidence, from content/public/hash-reuse-run.json, with the hash-list lineage cited to each service's own page.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const RESULTS = read("docs", "results.md");
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

  it("docs/results.md states them in one line, two hashes first, with the lineage", () => {
    const at = RESULTS.indexOf("- **The pool, in short.**");
    expect(at).toBeGreaterThan(-1);
    const pool = RESULTS.slice(at, RESULTS.indexOf("\n- **", at + 1));
    const limits = poolLimits().sentence.replace(/\.$/, "");
    expect(pool).toContain(limits);
    // Wherever docs/results.md gives both, it gives the two-hash figure first.
    const t = run.totals;
    const both = RESULTS.indexOf(`${run.phash.inUse.either.caught} of ${t.n}`);
    const alone = Math.max(RESULTS.indexOf(`${t.caught4} of ${t.n}`), RESULTS.indexOf(`catches ${t.caught4} at`));
    expect(both).toBeGreaterThan(-1);
    expect(alone).toBeGreaterThan(both);
    for (const src of [HASH_LINEAGE.photoDna, HASH_LINEAGE.stopNcii]) {
      expect(pool).toContain(`[${src.name}](${src.url})`);
    }
    expect(pool).toContain("shares only two 64-bit hashes and a row id");
    // The second hash's figures, from the same run, in the same line.
    expect(pool).toContain(poolLimits().second.replace(/\.$/, ""));
    expect(pool).toContain("open code");
    // The README says what crosses between firms the same way.
    expect(read("README.md")).toContain("only the hash and a row id cross");
  });

  it("/evidence shows them beside the two-firm run", () => {
    const page = read("src", "app", "evidence", "page.tsx");
    expect(page).toMatch(/<Network \/>\s+<DocketReplay \/>\s+<PoolLimits \/>/);
    expect(page).toContain("poolLimits().sentence");
    const comp = read("src", "components", "evidence", "PoolLimits.tsx");
    for (const k of ["L.photoDna.url", "L.stopNcii.url", "L.differs"]) expect(comp).toContain(k);
  });
});
