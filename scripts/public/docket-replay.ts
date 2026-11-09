/**
 * A replay, in code, of the pattern the CPSC's 2026 docket on recall claims describes: one device filing over 400
 * claims, with photos taken from the same vantage point (PROBLEM.truepicComment in src/lib/research.ts). It replays
 * the pattern, not the real claims: no claim, photo or firm from that docket is used. No model call, no network and no
 * database.
 *
 *   npx tsx scripts/public/docket-replay.ts
 *
 * 1. One claimed photo: Brightline's sample charger with its cord cut, verified on Brightline Home's sample recall
 *    (the recorded preset). Its two hashes join the pool as the claim route stores them (image_hash, source "claim").
 *    The live site keeps Brightline's published sample photo out of the pool, so every visitor can try it; here it
 *    stands in for an owner's first claim.
 * 2. 400 copies of it, each made by one to three of the changes the reuse run measures (scripts/public/hash-reuse-run.ts:
 *    saved again, resized, cropped, turned, brightened, darkened, screenshotted, mirrored), chosen in turn by a seeded
 *    generator, so the same 400 come out every time.
 * 3. Each copy is filed as a claim, by turns at Brightline Home (BH-2026-01) and Fernway Home (FW-2026-01), through the
 *    verifier the claim route calls (src/lib/verify), with the pool rows that route reads: this recall's claims as
 *    priorHashes, every other recall's as elsewhereHashes. The model is a stand-in that only notes it was reached.
 * 4. A claim the pool holds joins the pool, as the claim route adds every claim not asked for a new photo. A claim
 *    that goes on to the model step is left out of the pool, since its answer is not replayed; that can only lower
 *    the count.
 *
 * Writes content/public/docket-replay.json. tests/docket-replay.test.ts checks the file and runs the first claims again.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifyRecallFor } from "@/app/api/claims/_lib/recall";
import { recallByNumber, storedRule } from "@/lib/api/recall-data";
import { sampleFirmOf } from "@/lib/recall/label";
import { PROBLEM } from "@/lib/research";
import { photoHashes, verifyPhoto } from "@/lib/verify";
import { FIXTURES_DIR } from "@/lib/verify/fixtures";
import { setLogSink } from "@/lib/log";
import { decodeHashGrey } from "@/lib/verify/image";
import { phashGrey } from "@/lib/verify/phash";
import type { HashRef } from "@/lib/verify/types";
import { VARIANTS } from "./hash-reuse-run";

const OUT = path.join(process.cwd(), "content", "public", "docket-replay.json");

export const DOCKET = {
  photo: "sample/cord-cut.jpg",
  claims: 400,
  seed: 20138,
  /** Filed by turns, first at Brightline, where the photo was first claimed. */
  firms: [
    { recall: "BH-2026-01", amount: "34.99" },
    { recall: "FW-2026-01", amount: "29.99" },
  ],
} as const;

/** A small seeded generator (mulberry32), so the copies are the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The changes behind each copy: one to three distinct changes from the reuse run, in the order applied, every copy a
 * different combination. Pure, so the test can compare it with the file.
 */
export function copyPlan(n: number = DOCKET.claims, seed: number = DOCKET.seed): string[][] {
  const next = rng(seed);
  const kinds = VARIANTS.map((v) => v.kind);
  const seen = new Set<string>();
  const out: string[][] = [];
  while (out.length < n) {
    const len = 1 + Math.floor(next() * 3);
    const pick: string[] = [];
    while (pick.length < len) {
      const k = kinds[Math.floor(next() * kinds.length)];
      if (!pick.includes(k)) pick.push(k);
    }
    const key = pick.join("+");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pick);
  }
  return out;
}

export async function makeCopy(src: Buffer, steps: string[]): Promise<Buffer> {
  let b = src;
  for (const k of steps) b = await VARIANTS.find((v) => v.kind === k)!.make(b);
  return b;
}

type PoolRow = HashRef & { recall: string };
export type ReplayRow = { n: number; firm: string; recall: string; steps: string[]; decision: string; decided_by: string; reached_model: boolean; held_by: "same recall" | "another recall" | null; ms: number };

/** The first claim's pool row: the photo's two hashes, as the claim route stores them after Brightline's claim. */
export async function firstClaim(bytes: Buffer): Promise<PoolRow> {
  const { dhash } = await photoHashes(bytes);
  const phash = phashGrey(await decodeHashGrey(bytes));
  return { ref: "claim-0", recall: DOCKET.firms[0].recall, dhash, phash };
}

/** Files one copy as a claim with the pool as it stands, and says what the hash step did. */
export async function fileClaim(copy: Buffer, n: number, pool: PoolRow[]): Promise<{ row: ReplayRow; joins: PoolRow | null }> {
  const firm = DOCKET.firms[n % DOCKET.firms.length];
  const recall = recallByNumber(firm.recall)!;
  let reached = false;
  const started = performance.now();
  const r = await verifyPhoto(
    {
      photo: copy,
      recall: verifyRecallFor(recall),
      proofRule: storedRule(firm.recall)!.rule,
      priorHashes: pool.filter((p) => p.recall === firm.recall).map(({ ref, dhash, phash }) => ({ ref, dhash, phash })),
      elsewhereHashes: pool.filter((p) => p.recall !== firm.recall).map(({ ref, dhash, phash }) => ({ ref, dhash, phash })),
      claimContext: { firmAmount: { value: firm.amount, currency: "USD" }, autoCap: { value: "50.00", currency: "USD" }, firmName: sampleFirmOf(firm.recall) ?? undefined },
      options: { cache: false, reviewers: false },
    },
    {
      aiAvailable: () => true,
      cache: null,
      overBudget: async () => ({ over: false, usd: 0, budget: Infinity }),
      // Stands in for Claude: it never answers, it only notes that the claim reached the model step.
      vision: async () => {
        reached = true;
        throw new Error("not called in this replay");
      },
    },
  );
  const c3 = r.checks.C3;
  const held = !reached && r.decision === "firm_review" && c3.status === "fail" ? (/another recall/.test(c3.reason_plain) ? "another recall" : "same recall") : null;
  const row: ReplayRow = { n: n + 1, firm: sampleFirmOf(firm.recall) ?? firm.recall, recall: firm.recall, steps: [], decision: r.decision, decided_by: r.decided_by, reached_model: reached, held_by: held, ms: Math.round(performance.now() - started) };
  const joins = held && r.photo.dhash ? { ref: `claim-${n + 1}`, recall: firm.recall, dhash: r.photo.dhash, phash: r.photo.phash ?? null } : null;
  return { row, joins };
}

/** The replay itself, shared with the test: the first `count` claims of the plan. */
export async function replay(count: number = DOCKET.claims): Promise<{ rows: ReplayRow[]; first: PoolRow; poolEnd: number }> {
  const bytes = readFileSync(path.join(FIXTURES_DIR, DOCKET.photo));
  const first = await firstClaim(bytes);
  const pool: PoolRow[] = [first];
  const plan = copyPlan().slice(0, count);
  const rows: ReplayRow[] = [];
  for (const [i, steps] of plan.entries()) {
    const copy = await makeCopy(bytes, steps);
    const { row, joins } = await fileClaim(copy, i, pool);
    rows.push({ ...row, steps });
    if (joins) pool.push(joins);
  }
  return { rows, first, poolEnd: pool.length };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)) : 0;
};

/** The counts, from the rows alone (the test derives them again). */
export function totals(rows: ReplayRow[]) {
  const held = rows.filter((r) => r.held_by);
  return {
    claims: rows.length,
    held: held.length,
    heldAcrossFirms: held.filter((r) => r.held_by === "another recall").length,
    heldSameRecall: held.filter((r) => r.held_by === "same recall").length,
    newPhotoAsked: rows.filter((r) => !r.reached_model && r.decision === "retake").length,
    reachedModel: rows.filter((r) => r.reached_model).length,
    /** Of the claims that went on to the model step, how many include a phone screenshot among their changes. */
    reachedModelScreenshot: rows.filter((r) => r.reached_model && r.steps.includes("screenshot")).length,
    /** Of the new photos asked for in code, how many by the photo-quality check (a copy shrunk too far). */
    newPhotoQuality: rows.filter((r) => !r.reached_model && r.decision === "retake" && r.decided_by === "quality").length,
    paid: rows.filter((r) => r.decision === "verified").length,
    byFirm: Object.fromEntries([...new Set(rows.map((r) => r.firm))].map((f) => [f, { claims: rows.filter((r) => r.firm === f).length, held: held.filter((r) => r.firm === f).length }])),
    medianMs: median(rows.map((r) => r.ms)),
  };
}

async function main() {
  // Each claim that reaches the stand-in model logs that the vision check did not finish; counted, not printed.
  let unfinished = 0;
  setLogSink((level, line) => {
    if (level === "warn" && /vision check did not finish/.test(line)) unfinished++;
    else process.stderr.write(`${line}\n`);
  });
  const { rows, first, poolEnd } = await replay();
  setLogSink(null);
  if (unfinished !== rows.filter((r) => r.reached_model).length) throw new Error(`Expected one unfinished vision check per claim that reached the model; got ${unfinished}.`);
  const t = totals(rows);
  const out = {
    note: `A replay of the pattern on the CPSC's 2026 docket on recall claims (one device filing over ${PROBLEM.truepicComment.claims} claims, photos from the same vantage point), not of the real claims: one claimed sample photo, ${rows.length} copies made with the changes the reuse run measures, filed by turns at two fictional sample firms through the claim path's hash step with no model call, no network and no database. Recorded by scripts/public/docket-replay.ts; tests/docket-replay.test.ts checks it and runs the first claims again.`,
    recordedAt: new Date().toISOString(),
    pattern: { source: PROBLEM.truepicComment.source, url: PROBLEM.truepicComment.url, date: PROBLEM.truepicComment.date, claims: PROBLEM.truepicComment.claims, docket: PROBLEM.fraudRfi.docket },
    photo: { file: `content/verify/fixtures/${DOCKET.photo}`, credit: "Dmitry G, Wikimedia Commons, public domain (public/samples/charger/CREDITS.json)" },
    first: { firm: sampleFirmOf(DOCKET.firms[0].recall), recall: first.recall, dhash: first.dhash, phash: first.phash },
    seed: DOCKET.seed,
    changes: VARIANTS.map((v) => ({ kind: v.kind, label: v.label, parameters: v.parameters })),
    firms: DOCKET.firms.map((f) => ({ firm: sampleFirmOf(f.recall), recall: f.recall })),
    totals: { ...t, poolEnd },
    model_calls: 0,
    rows,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`docket replay: ${t.held} of ${t.claims} held by the pool before any model call (${t.heldAcrossFirms} across firms, ${t.heldSameRecall} on the same recall); ${t.newPhotoAsked} asked for a new photo; ${t.reachedModel} went on to the model step; paid ${t.paid}; median ${t.medianMs} ms a claim`);
}

if (process.argv[1] && /docket-replay\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
