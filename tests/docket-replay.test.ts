import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLogSink } from "@/lib/log";
import { PROBLEM } from "@/lib/research";
import { CATALOG_MAX_DISTANCE } from "@/lib/verify/dhash";
import { copyPlan, DOCKET, replay, totals, type ReplayRow } from "../scripts/public/docket-replay";
import { VARIANTS } from "../scripts/public/hash-reuse-run";

/**
 * The docket replay (content/public/docket-replay.json, written by scripts/public/docket-replay.ts): the pattern on the
 * CPSC's 2026 docket, one device filing over 400 claims, replayed in code with one claimed sample photo and 400 copies
 * of it filed at two sample firms. The counts must follow from the file's own rows, the copies from the seeded plan, and
 * the first claims must come out the same when they are made and filed again.
 */
type Docket = {
  note: string;
  pattern: { claims: string; url: string; docket: string };
  seed: number;
  firms: { firm: string; recall: string }[];
  totals: ReturnType<typeof totals> & { poolEnd: number };
  model_calls: number;
  rows: ReplayRow[];
};
const file = JSON.parse(readFileSync(path.join(process.cwd(), "content", "public", "docket-replay.json"), "utf8")) as Docket;

/** The stand-in model's unanswered calls log a warning by design; read back here instead of printed. */
const logged: { level: string; msg: string }[] = [];
beforeEach(() => {
  logged.length = 0;
  setLogSink((level, line) => logged.push({ level, msg: (JSON.parse(line) as { msg: string }).msg }));
});
afterEach(() => setLogSink(null));

describe("the docket replay (content/public/docket-replay.json)", () => {
  it("replays the docket's pattern, labelled as a replay, with 400 copies of one photo at two sample firms and no model call", () => {
    expect(file.pattern.claims).toBe(PROBLEM.truepicComment.claims);
    expect(file.pattern.url).toBe(PROBLEM.truepicComment.url);
    expect(file.note).toMatch(/^A replay of the pattern/);
    expect(file.note).toMatch(/not of the real claims/);
    expect(file.rows).toHaveLength(DOCKET.claims);
    expect(file.firms.map((f) => f.firm)).toEqual(["Brightline Home", "Fernway Home"]);
    expect(file.model_calls).toBe(0);
    expect(file.seed).toBe(DOCKET.seed);
  });

  it("each copy is the seeded plan's: one to three distinct changes from the reuse run, every combination different", () => {
    const plan = copyPlan();
    expect(file.rows.map((r) => r.steps)).toEqual(plan);
    const kinds = new Set(VARIANTS.map((v) => v.kind));
    for (const steps of plan) {
      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps.length).toBeLessThanOrEqual(3);
      expect(new Set(steps).size).toBe(steps.length);
      for (const k of steps) expect(kinds.has(k)).toBe(true);
    }
    expect(new Set(plan.map((s) => s.join("+"))).size).toBe(plan.length);
  });

  it("the counts follow from the rows, and nothing is paid", () => {
    const t = totals(file.rows);
    expect({ ...file.totals, medianMs: 0 }).toEqual({ ...t, poolEnd: file.totals.poolEnd, medianMs: 0 });
    expect(t.held + t.newPhotoAsked + t.reachedModel).toBe(t.claims);
    expect(t.paid).toBe(0);
    // The pool grows by the claims it held, as the claim route adds every claim not asked for a new photo.
    expect(file.totals.poolEnd).toBe(1 + t.held);
    // Every copy that went on to the model step includes a phone screenshot, the one change the reuse run says gets past both hashes.
    expect(t.reachedModelScreenshot).toBe(t.reachedModel);
    // Both firms hold copies: Fernway's first hold comes from Brightline's hash, across firms.
    expect(t.heldAcrossFirms).toBeGreaterThan(0);
    for (const f of Object.values(t.byFirm)) expect(f.held).toBeGreaterThan(0);
    expect(CATALOG_MAX_DISTANCE).toBe(4);
  });

  it("the first claims come out the same when the copies are made and filed again", { timeout: 120_000 }, async () => {
    const K = 24;
    const again = await replay(K);
    const strip = (r: ReplayRow) => ({ ...r, ms: 0 });
    // libvips can round a resize or a turn differently from one platform build to another, which can move a copy across
    // a threshold; on the machine that wrote the file they are equal. At most one of the first claims may differ.
    const differ = again.rows.filter((r, i) => JSON.stringify(strip(r)) !== JSON.stringify(strip(file.rows[i])));
    expect(differ.length, JSON.stringify(differ)).toBeLessThanOrEqual(1);
    expect(again.rows.every((r) => r.decision !== "verified")).toBe(true);
    // Each claim that reached the stand-in model logged that the vision check did not finish, and nothing else was logged.
    expect(logged.filter((l) => l.level !== "warn")).toEqual([]);
    expect(logged.length).toBe(again.rows.filter((r) => r.reached_model).length);
  });

  it("the home page, the README and docs/results.md state it as a replay of the pattern, with the file's figures", () => {
    const t = file.totals;
    for (const f of ["README.md", "docs/results.md"]) {
      const text = readFileSync(path.join(process.cwd(), f), "utf8");
      expect(text, f).toContain(`**${t.held} of ${t.claims}**`);
      expect(text, f).toMatch(/replay of the pattern/i);
      expect(text, f).toContain("content/public/docket-replay.json");
      expect(text, f).toContain(t.paid === 0 ? `none of the ${t.claims} was paid` : `${t.paid} of ${t.claims}`);
    }
    const home = readFileSync(path.join(process.cwd(), "src", "app", "page.tsx"), "utf8");
    expect(home).toContain("docketWords()");
  });
});
