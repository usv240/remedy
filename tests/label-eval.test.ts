import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadRecalls } from "@/lib/recall/search";
import { codeOf, recallCodes } from "@/lib/recall/codes";
import { recallModels } from "@/lib/label/check";
import { changeDigits, listed, ORDINARY, readingsFor, runOne, type Eval, type Reading } from "../scripts/label/eval-catalog";
import { estimateUsd, plan } from "../scripts/label/eval-photos";

/**
 * The label check against the recall list (content/public/label-eval.json, written by scripts/label/eval-catalog.ts):
 * the file's counts follow from its own lists, and a fixed slice of the readings, run again here with no model call,
 * comes out as the file says. The whole run takes about 30 s, so it is not repeated in full on every test run.
 */
const evalFile = JSON.parse(readFileSync(path.join(process.cwd(), "content", "public", "label-eval.json"), "utf8")) as Eval;

beforeEach(() => {
  for (const k of ["ELASTIC_URL", "ELASTIC_API_KEY", "DATABASE_URL", "ANTHROPIC_API_KEY"]) delete process.env[k];
});

describe("the label check against the recall list (content/public/label-eval.json)", () => {
  it("its counts follow from its own lists, and its sentence says them", () => {
    const p = evalFile.positives;
    const n = evalFile.negatives;
    expect(Object.values(p.byKind).reduce((s, k) => s + k.n, 0)).toBe(p.n);
    expect(Object.values(p.byKind).reduce((s, k) => s + k.ok, 0)).toBe(p.ok);
    expect(Object.values(n.byKind).reduce((s, k) => s + k.n, 0)).toBe(n.n);
    expect(p.n - p.ok).toBe(p.missed.length);
    expect(n.n - n.ok).toBe(n.matched.length);
    expect(n.byKind.ordinary.n).toBe(ORDINARY.length);
    expect(evalFile.sentence).toBe(`Found the right recall for ${p.ok.toLocaleString("en-US")} of ${p.n.toLocaleString("en-US")} label readings; ${n.ok.toLocaleString("en-US")} of ${n.n.toLocaleString("en-US")} not-recalled products matched no recall.`);
    expect(evalFile.catalog.recalls).toBe(loadRecalls().length);
    expect(evalFile.note).toMatch(/no model call/);
  });

  it("a fixed slice of the readings, run again, comes out as the file says", async () => {
    const recalls = loadRecalls();
    const everyCode = new Set<string>();
    for (const r of recalls) for (const c of recallCodes(r).models) everyCode.add(c);
    for (const r of recalls) for (const m of recallModels(r)) everyCode.add(codeOf(m));
    // Every 25th recall with codes, and every ordinary product.
    const withCodes = recalls.filter((r) => listed(r).models.length || listed(r).upcs.length);
    const slice: Reading[] = withCodes.filter((_, i) => i % 25 === 0).flatMap((r) => readingsFor(r, everyCode));
    slice.push(...ORDINARY.map((o): Reading => ({ kind: "ordinary", recall: null, brand: o.brand, product: o.product, model: o.model, upc: null })));
    expect(slice.length).toBeGreaterThan(80);
    const key = (x: Pick<Reading, "kind" | "recall" | "model" | "upc" | "brand">) => JSON.stringify([x.kind, x.recall, x.model, x.upc, x.brand]);
    const missed = new Set([...evalFile.positives.missed, ...evalFile.negatives.matched].map(key));
    for (const x of slice) {
      const r = await runOne(x);
      expect(r.found, key(x)).toBe(!missed.has(key(x)));
    }
  }, 60_000);

  it("the negative controls are codes no recall holds, and the OCR variants are spacing, dashes and case only", () => {
    expect(changeDigits("KC101B")).toBe("KC434B");
    for (const r of evalFile.negatives.matched) expect(r.kind).not.toBe("ordinary");
    expect(evalFile.negatives.byKind.ordinary.ok).toBe(ORDINARY.length);
  });
});

describe("the prepared photo eval (content/label/photo-eval-cases.json)", () => {
  type Case = { id: string; url: string; sha256: string; expect: { outcome: string; recall: string | null; code: string | null }; credit: string };
  const file = JSON.parse(readFileSync(path.join(process.cwd(), "content", "label", "photo-eval-cases.json"), "utf8")) as { written_at: string; cases: Case[] };

  it("lists each picture with its source, its SHA-256 and the answer it must give, written before any run", () => {
    expect(file.cases.length).toBeGreaterThanOrEqual(20);
    for (const c of file.cases) {
      expect(c.sha256, c.id).toMatch(/^[0-9a-f]{64}$/);
      expect(c.url, c.id).toMatch(/^https:\/\//);
      expect(c.credit, c.id).toBeTruthy();
      if (c.expect.recall) {
        expect(c.url, c.id).toMatch(/cpsc\.gov/);
        expect(loadRecalls().some((r) => r.number === c.expect.recall), c.id).toBe(true);
      } else expect(c.expect.outcome).toBe("no_recall");
    }
    expect(file.cases.filter((c) => !c.expect.recall).length).toBeGreaterThanOrEqual(3);
  });

  it("is not run yet, and its cost is estimated from the picture sizes", () => {
    let ran = true;
    try {
      readFileSync(path.join(process.cwd(), "content", "label", "photo-eval-results.json"));
    } catch {
      ran = false;
    }
    expect(ran).toBe(false);
    const p = plan();
    expect(p.cases).toBe(file.cases.length);
    expect(p.total).toBeGreaterThan(0.3);
    expect(p.total).toBeLessThan(1.5);
    expect(estimateUsd({ width: 1200, height: 740 })).toBeCloseTo(0.0277, 3);
  });
});
