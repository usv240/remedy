/**
 * The two errors that matter for money, counted on every recorded decision of the photo engine where the right answer
 * is known. Server only; computed from files in the repo each time the page is built, never typed in by hand.
 *
 *  - Paid when it should not have been: the engine decided "verified" (the code would pay) on a photo whose known
 *    answer is not to pay.
 *  - Held back when it could have been paid: the photo's known answer is to pay, and the engine sent it to a person at
 *    the firm (firm_review) or asked for a new photo (retake).
 *
 * The decisions come from three files:
 *  - content/verify/sweep-results.json: the measured sweep, three trials per case. Only the claim path's own setting
 *    (Claude Opus 5.5 at medium effort) counts toward the two rates; all four configurations are reported beside them.
 *  - content/verify/sweep-sample.json: the same sweep at the claim path's setting on the photos for Brightline Home's
 *    fictional sample recall (one real charger: its cord cut, and opened up with its cord still attached).
 *  - content/presets/recorded/*.json: each /try preset's one recorded live answer, with the decision it led to.
 *  - content/public/verify-runs.json: the public recorded runs. A run that replays a preset's recording, or reads the
 *    same model answer back from the verification cache, is counted once, with the preset.
 * The known answers come from content/verify/fixtures/cases.json (read by src/lib/verify/fixtures.ts) and the
 * presets' own expected decision in content/presets/index.json.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LIMITS } from "@/lib/verify/checks";

const ROOT = process.cwd();
/** A JSON file under content/, the only folder these figures are read from (a fixed root keeps the build from tracing the whole project). */
const read = <T>(...p: string[]): T => JSON.parse(readFileSync(path.join(ROOT, "content", ...p), "utf8")) as T;

type Expect = { decision?: string; not_decision?: string; checks?: Record<string, string> };
type Case = { id: string; photo: string; recall: string; official_hash_check?: boolean; expect: Expect };
type Known = "paid" | "not_paid";

/**
 * A known answer, from a case's expectation: "verified" names a payment; any other named decision, or "anything but
 * verified", names none; right product and made safe both required (with no decision named) names a payment too.
 * Anything else is not a known answer for money and is left out.
 *
 * A recall's own published picture (content/verify/fixtures/official/) is never an owner's photo, so it is never a
 * payment: run with the official-picture match switched off, those cases measure reading (right product, made safe),
 * and asking for the owner's own photo is the right answer for money. They count toward a money rate only where the
 * case names a decision.
 */
export function knownAnswer(e: Expect | undefined, photo?: string): Known | null {
  if (!e) return null;
  if (e.decision === "verified") return "paid";
  if (e.decision || e.not_decision === "verified") return "not_paid";
  if (photo?.startsWith("official/")) return null;
  if (e.checks?.C1 === "pass" && e.checks?.C2 === "pass") return "paid";
  return null;
}

/** Plain names for the photos that appear in a "what happened" line. Others fall back to their case id. */
const TITLES: Record<string, string> = {
  "made-safe-hair-dryer-cord-cut": "the CPSC's own photo of the recall 26125 hair dryer with its cord cut, sent with the official-picture match switched off",
  "made-safe-helmet-straps-cut": "the CPSC's own photo of the recall 25007 helmet with its straps cut, sent with the official-picture match switched off",
  "sample-charger-cut": "Brightline's sample charger with its cord cut",
  "sample-charger-opened-cord-attached": "Brightline's sample charger opened up, its cord still attached",
  "sample-charger-opened-case": "Brightline's sample charger taken apart, its cord still wired to the board",
};

/**
 * The public runs answered with no AI call, and how many asked for a new photo: a copy of the official picture, a
 * reused photo, a blurry one or another recall's picture is never verified (content/public/verify-runs.json).
 */
export function freeCaught() {
  const runs = read<{ runs: { needs_vision?: boolean; result: { decision: string } }[] }>("public", "verify-runs.json").runs;
  const free = runs.filter((r) => !r.needs_vision);
  return { caught: free.filter((r) => r.result.decision !== "verified").length, total: free.length };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};
const spread = (xs: number[]) => ({ median: median(xs), min: xs.length ? Math.min(...xs) : 0, max: xs.length ? Math.max(...xs) : 0, n: xs.length });

/**
 * How long the free answers took, from the recorded runs themselves (content/public/verify-runs.json, timed on the
 * machine that recorded them): the whole answer (decoding the photo, loading the recall's pictures, the hash match,
 * the decision), and the hash comparison alone. `official` is the subset answered by a match with a recall's own
 * published picture; `free` is every run answered with no model call. Also how the free runs ended: a new photo asked
 * for, or a person at the firm (a photo already used on an earlier claim).
 */
export function freeTimings() {
  type T = { decode_ms: number; official_ms: number; match_ms?: number; total_ms: number };
  const runs = read<{ recordedAt: string; runs: { id: string; needs_vision?: boolean; result: { decision: string; decided_by: string; timings: T } }[] }>("public", "verify-runs.json");
  const free = runs.runs.filter((r) => !r.needs_vision);
  const official = free.filter((r) => r.result.decided_by === "own_photo");
  const match = free.map((r) => r.result.timings.match_ms).filter((m): m is number => typeof m === "number");
  return {
    recordedAt: runs.recordedAt,
    free: spread(free.map((r) => r.result.timings.total_ms)),
    official: spread(official.map((r) => r.result.timings.total_ms)),
    match: spread(match),
    retake: free.filter((r) => r.result.decision === "retake").length,
    firmReview: free.filter((r) => r.result.decision === "firm_review").length,
  };
}

/** The sweep configuration that is the claim path's own setting (src/lib/verify/vision.ts: Opus 5.5, medium effort). */
export const CLAIM_PATH_CONFIG = "opus-medium";
/** A public run that replays a preset's recording: the same model answer, counted once with the preset. */
const REPLAYS = new Set(["sample-charger-cut"]);
/** A public run recorded under another id than its fixture case. */
const PUBLIC_CASE: Record<string, string> = { "cord-cut-example": "made-safe-hair-dryer-cord-cut" };

export type Decided = {
  source: "sweep" | "sample" | "preset" | "public";
  caseId: string;
  trial: number | null;
  decision: string;
  known: Known;
  /** The model said the photo was not the owner's own camera photo (the CPSC's published picture, a screen, a download). */
  notOwn: boolean;
};

type SweepFile = { ranAt: string; trials: number; configs: { id: string; model: string; effort?: string }[]; cases: { config: string; trial: number; case: string; decision: string; C3: string }[] };
type PresetIndex = { presets: { id: string; recall: string; photo: string; expected: Expect; recorded?: string; technical?: { recorded: string; options: { officialHashCheck?: boolean } } }[] };
type Recording = { recorded_at: string; decision: string; options?: { officialHashCheck?: boolean }; vision: { report: { photo_source?: { kind: string } } } | null };
type RunsFile = { recordedAt: string; runs: { id: string; recall: string; photo: string; result: { decision: string; summary?: { technical: string }; checks: Record<string, { status: string }> } }[] };

export const SOURCES = {
  sweep: "content/verify/sweep-results.json",
  sample: "content/verify/sweep-sample.json",
  presets: "content/presets/recorded/*.json",
  runs: "content/public/verify-runs.json",
  cases: "content/verify/fixtures/cases.json",
  presetIndex: "content/presets/index.json",
} as const;

function caseFor(cases: Case[], recall: string, photo: string, hashOff: boolean): Case | undefined {
  return cases.find((c) => c.recall === recall && c.photo === photo && (c.official_hash_check === false) === hashOff);
}

/** Every recorded decision with a known answer for money. */
/** A reading case on the recall's own published picture (no decision named): outside both money rates, reported beside them. */
const isOfficialReading = (c: Case | undefined) => Boolean(c && c.photo.startsWith("official/") && !c.expect.decision && !c.expect.not_decision);

export function decisions(config = CLAIM_PATH_CONFIG): { all: Decided[]; sweep: SweepFile; sample: SweepFile | null; allConfigs: Decided[]; officialPicture: { caseId: string; decision: string }[] } {
  const cases = read<{ cases: Case[] }>("verify", "fixtures", "cases.json").cases;
  const byId = new Map(cases.map((c) => [c.id, c]));
  const sweep = read<SweepFile>("verify", "sweep-results.json");
  const out: Decided[] = [];
  const allConfigs: Decided[] = [];
  const officialPicture: { caseId: string; decision: string }[] = [];

  for (const row of sweep.cases) {
    const known = knownAnswer(byId.get(row.case)?.expect, byId.get(row.case)?.photo);
    if (!known && row.config === config && isOfficialReading(byId.get(row.case))) officialPicture.push({ caseId: row.case, decision: row.decision });
    if (!known) continue;
    const d: Decided = { source: "sweep", caseId: row.case, trial: row.trial, decision: row.decision, known, notOwn: row.C3 === "unclear" || row.C3 === "fail" };
    allConfigs.push(d);
    if (row.config === config) out.push(d);
  }

  // The sample recall's photos, run at the claim path's setting only: in the two rates, not in the four-setting figure.
  const sample = existsSync(path.join(ROOT, "content", "verify", "sweep-sample.json")) ? read<SweepFile>("verify", "sweep-sample.json") : null;
  for (const row of sample?.cases ?? []) {
    if (row.config !== config) continue;
    const known = knownAnswer(byId.get(row.case)?.expect, byId.get(row.case)?.photo);
    if (known) out.push({ source: "sample", caseId: row.case, trial: row.trial, decision: row.decision, known, notOwn: row.C3 === "unclear" || row.C3 === "fail" });
  }

  const index = read<PresetIndex>("presets", "index.json");
  const recDir = path.join(ROOT, "content", "presets", "recorded");
  const recording = (name: string | undefined): Recording | null => (name && existsSync(path.join(recDir, name)) ? read<Recording>("presets", "recorded", name) : null);
  for (const p of index.presets) {
    for (const [name, hashOff, own] of [
      [p.recorded, false, p.expected],
      [p.technical?.recorded, p.technical?.options.officialHashCheck === false, undefined],
    ] as const) {
      const rec = recording(name);
      if (!rec?.vision) continue;
      const c = caseFor(cases, p.recall, p.photo, hashOff);
      const known = knownAnswer(own?.decision ? own : c?.expect, p.photo);
      if (!known && !own?.decision && isOfficialReading(c)) officialPicture.push({ caseId: c!.id, decision: rec.decision });
      if (!known) continue;
      const kind = rec.vision.report.photo_source?.kind;
      out.push({ source: "preset", caseId: c?.id ?? p.id, trial: null, decision: rec.decision, known, notOwn: Boolean(kind && kind !== "camera_photo") });
    }
  }

  const runs = read<RunsFile>("public", "verify-runs.json");
  for (const r of runs.runs) {
    // A run that replays a preset's recording, or reads the model's answer back from the verification cache, repeats
    // a decision already counted: the same model answer, counted once.
    if (REPLAYS.has(r.id) || /verification cache/.test(r.result.summary?.technical ?? "")) continue;
    const c = byId.get(PUBLIC_CASE[r.id] ?? r.id);
    const known = knownAnswer(c?.expect, c?.photo);
    if (c && !known && isOfficialReading(c)) officialPicture.push({ caseId: c.id, decision: r.result.decision });
    if (!c || !known) continue;
    const c3 = r.result.checks.C3?.status;
    out.push({ source: "public", caseId: c.id, trial: null, decision: r.result.decision, known, notOwn: c3 === "unclear" || c3 === "fail" });
  }
  return { all: out, sweep, sample, allConfigs, officialPicture };
}

export type ErrorRate = {
  count: number;
  of: number;
  /** Distinct photos (fixture cases) behind the decisions. */
  cases: number;
  /** The decisions that make up `count`, by photo: how many went to a person, how many asked for a retake. */
  misses: { caseId: string; title: string; n: number; firmReview: number; retake: number; verified: number; notOwn: number }[];
};

function rate(list: Decided[], miss: (d: Decided) => boolean): ErrorRate {
  const misses = new Map<string, ErrorRate["misses"][number]>();
  for (const d of list.filter(miss)) {
    const m = misses.get(d.caseId) ?? { caseId: d.caseId, title: TITLES[d.caseId] ?? d.caseId, n: 0, firmReview: 0, retake: 0, verified: 0, notOwn: 0 };
    m.n++;
    if (d.decision === "firm_review") m.firmReview++;
    else if (d.decision === "retake") m.retake++;
    else if (d.decision === "verified") m.verified++;
    if (d.notOwn) m.notOwn++;
    misses.set(d.caseId, m);
  }
  return { count: list.filter(miss).length, of: list.length, cases: new Set(list.map((d) => d.caseId)).size, misses: [...misses.values()].sort((a, b) => b.n - a.n) };
}

/** The two rates, the sweep's own figures beside them, and where each number came from. */
export function errorRates() {
  const { all, sweep, sample, allConfigs, officialPicture } = decisions();
  const notPaid = all.filter((d) => d.known === "not_paid");
  const paid = all.filter((d) => d.known === "paid");
  const wrongPay = rate(notPaid, (d) => d.decision === "verified");
  const heldBack = rate(paid, (d) => d.decision !== "verified");
  const sweepRows = all.filter((d) => d.source === "sweep");
  const allNotPaid = allConfigs.filter((d) => d.known === "not_paid");
  return {
    wrongPay,
    heldBack,
    decisions: all.length,
    /** The recall's own published picture sent as a claim photo, with the official-picture match off: never paid is right. */
    officialPicture: { of: officialPicture.length, paid: officialPicture.filter((d) => d.decision === "verified").length, cases: new Set(officialPicture.map((d) => d.caseId)).size },
    photos: new Set(all.map((d) => d.caseId)).size,
    bySource: (["sweep", "sample", "preset", "public"] as const).map((s) => ({ source: s, decisions: all.filter((d) => d.source === s).length })),
    sample: sample ? { photos: new Set(all.filter((d) => d.source === "sample").map((d) => d.caseId)).size, trials: sample.trials, ranAt: sample.ranAt } : null,
    sweep: {
      ranAt: sweep.ranAt,
      trials: sweep.trials,
      cases: new Set(sweepRows.map((d) => d.caseId)).size,
      decisions: sweepRows.length,
      configs: sweep.configs.length,
      allConfigsWrongPay: { count: allNotPaid.filter((d) => d.decision === "verified").length, of: allNotPaid.length },
    },
    sources: SOURCES,
  };
}

type SweepRow = SweepFile["cases"][number] & { C1_status?: string; C2?: string; C4?: string; usd?: number; ms?: number; ok?: boolean; vision_ms?: number; decided_by?: string };

/** Whether a sweep row meets its case's current known answer (the same rules as meetsExpectation in src/lib/verify/fixtures.ts). */
function meets(e: Expect & { not_checks?: Record<string, string>; decided_by?: string }, r: SweepRow): boolean {
  const status: Record<string, string | undefined> = { C1: r.C1_status, C2: r.C2, C3: r.C3, C4: r.C4 };
  if (e.decision && r.decision !== e.decision) return false;
  if (e.not_decision && r.decision === e.not_decision) return false;
  if (e.decided_by && (r as { decided_by?: string }).decided_by !== e.decided_by) return false;
  for (const [id, s] of Object.entries(e.checks ?? {})) if (status[id] !== s) return false;
  for (const [id, s] of Object.entries(e.not_checks ?? {})) if (status[id] === s) return false;
  return true;
}

/** A known answer revised after the sweep ran: what it was, what it is now, and why (content/verify/answer-changes.json). */
export type AnswerChange = { date: string; case: string; photo: string; was: Expect & { decided_by?: string }; now: Expect & { decided_by?: string }; why: string };

export function answerChanges(): AnswerChange[] {
  return read<{ changes: AnswerChange[] }>("verify", "answer-changes.json").changes;
}

/**
 * The four model settings in the sweep, on the measure that matters for money first: paid when it should not have
 * been, then held back when it could have been paid. Accuracy is scored twice, in this order: `atSweep`, against the
 * known answers as they stood the day the sweep ran (each revised answer's `was` in content/verify/answer-changes.json;
 * tests/facts.test.ts checks it equals the sweep's own pass marks), then `correct`, re-scored against the answers in
 * content/verify/fixtures/cases.json today. `changed` counts, per revised answer, the trials whose score moved.
 */
export function sweepSettings() {
  const cases = read<{ cases: (Case & { not_checks?: Record<string, string> })[] }>("verify", "fixtures", "cases.json").cases;
  const byId = new Map(cases.map((c) => [c.id, c]));
  const was = new Map(answerChanges().map((a) => [a.case, a.was]));
  const sweep = read<Omit<SweepFile, "cases"> & { cases: SweepRow[] }>("verify", "sweep-results.json");
  return sweep.configs.map((cfg) => {
    const rows = sweep.cases.filter((r) => r.config === cfg.id);
    const known = rows.map((r) => ({ r, c: byId.get(r.case), k: knownAnswer(byId.get(r.case)?.expect, byId.get(r.case)?.photo) }));
    const thenScored = known.filter((x) => x.c).map((x) => ({ ...x, ok: meets(was.get(x.r.case) ?? x.c!.expect, x.r), now: meets(x.c!.expect, x.r) }));
    const notPaid = known.filter((x) => x.k === "not_paid");
    const paid = known.filter((x) => x.k === "paid");
    const scored = known.filter((x) => x.c);
    const usd = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
    const secs = rows.map((r) => (r.ms ?? 0) / 1000).sort((a, b) => a - b);
    return {
      id: cfg.id,
      model: cfg.model,
      effort: cfg.effort ?? null,
      claimPath: cfg.id === CLAIM_PATH_CONFIG,
      wrongPay: { count: notPaid.filter((x) => x.r.decision === "verified").length, of: notPaid.length },
      heldBack: { count: paid.filter((x) => x.r.decision !== "verified").length, of: paid.length },
      correct: { count: scored.filter((x) => meets(x.c!.expect, x.r)).length, of: scored.length },
      /** The CPSC's own published pictures sent with the official-picture match off: verified here would have paid for a published picture. */
      officialPaid: { count: known.filter((x) => !x.k && isOfficialReading(x.c) && x.r.decision === "verified").length, of: known.filter((x) => !x.k && isOfficialReading(x.c)).length },
      atSweep: { count: thenScored.filter((x) => x.ok).length, of: thenScored.length },
      /** The sweep's own pass marks, written when it ran: tests/facts.test.ts checks `atSweep` against them. */
      markedAtSweep: { count: rows.filter((r) => r.ok).length, of: rows.length },
      changed: answerChanges().map((a) => ({ case: a.case, trials: thenScored.filter((x) => x.r.case === a.case && x.ok !== x.now).length, of: thenScored.filter((x) => x.r.case === a.case).length })),
      usdPerCase: rows.length ? Math.round((usd / rows.length) * 10000) / 10000 : 0,
      medianSeconds: secs.length ? Math.round(secs[Math.floor((secs.length - 1) / 2)] * 10) / 10 : 0,
    };
  });
}

/**
 * Reading accuracy on real CPSC recalls: the CPSC's own published photos of recalled products made safe (recalls 26125
 * and 25007), sent with the official-picture match off at the claim path's setting, three trials each. Each trial gives
 * two readings, right product (C1) and made safe (C2), compared with the known reading in cases.json. `asked` lists the
 * trials that asked for a new photo, by the check that asked and whether the model's own-photo check also came back
 * unsure (it recognized the CPSC's published picture).
 */
export function readingAccuracy(config = CLAIM_PATH_CONFIG) {
  const cases = read<{ cases: Case[] }>("verify", "fixtures", "cases.json").cases;
  const reading = cases.filter((c) => c.photo.startsWith("official/") && c.official_hash_check === false && c.expect.checks?.C1 && c.expect.checks?.C2);
  const sweep = read<Omit<SweepFile, "cases"> & { cases: SweepRow[] }>("verify", "sweep-results.json");
  const rows = sweep.cases.filter((r) => r.config === config && reading.some((c) => c.id === r.case));
  const at = (r: SweepRow) => reading.find((c) => c.id === r.case)!.expect.checks!;
  const product = rows.filter((r) => r.C1_status === at(r).C1).length;
  const madeSafe = rows.filter((r) => r.C2 === at(r).C2).length;
  const asked = reading.map((c) => {
    const mine = rows.filter((r) => r.case === c.id);
    const retakes = mine.filter((r) => r.decision === "retake");
    return {
      caseId: c.id,
      trials: mine.length,
      retakes: retakes.length,
      byMadeSafe: retakes.filter((r) => r.C2 === "fail").length,
      madeSafeKnown: c.expect.checks!.C2,
      ownPhotoUnsure: retakes.filter((r) => r.C3 === "unclear" || r.C3 === "fail").length,
    };
  });
  return { photos: reading.length, recalls: new Set(reading.map((c) => c.recall)).size, trials: rows.length, readings: rows.length * 2, right: product + madeSafe, product, madeSafe, asked };
}


const secs = (ms: number) => Math.round(ms / 100) / 10;
const spreadSeconds = (ms: number[]) => {
  const s = spread(ms);
  return { median: secs(s.median), min: secs(s.min), max: secs(s.max), n: s.n };
};

type Recorded = { engine?: string; vision: { ms: number; replayed?: boolean } | null; reviews?: { ms: number; votes?: { ms?: number }[] } | null };

/**
 * How long a live photo check takes at the claim path's setting, from every recorded live Claude call in the repo: the
 * model sweep's rows at that setting, the sample recall's sweep, and each /try preset's recording. `check` is the one
 * vision call that reads the photo; `reviewers` is the extra time when the product match is unclear and the two
 * reviewers look closer (a sweep row's time minus its vision call, or a recording's reviewer run). A replayed answer
 * (read back from a cache, so not timed live) is left out. The flagship preset's own times are returned beside them, so
 * every page that shows that run can say where it sits in the range.
 */
export function checkTimes() {
  const sweep = read<{ cases: SweepRow[] }>("verify", "sweep-results.json").cases.filter((r) => r.config === CLAIM_PATH_CONFIG);
  const samplePath = path.join(ROOT, "content", "verify", "sweep-sample.json");
  const sample = existsSync(samplePath) ? read<{ cases: SweepRow[] }>("verify", "sweep-sample.json").cases.filter((r) => r.config === CLAIM_PATH_CONFIG) : [];
  const rows = [...sweep, ...sample].filter((r) => (r.vision_ms ?? 0) > 0);
  const vision = rows.map((r) => r.vision_ms ?? 0);
  const reviewers = rows.filter((r) => r.decided_by === "reviewers").map((r) => (r.ms ?? 0) - (r.vision_ms ?? 0));
  // The whole answer when the reviewers looked: the photo check and the two reviewers together, run by run.
  const both = rows.filter((r) => r.decided_by === "reviewers").map((r) => r.ms ?? 0);
  const index = read<PresetIndex>("presets", "index.json");
  const recDir = path.join(ROOT, "content", "presets", "recorded");
  let flagship: { checkMs: number; reviewersMs: number } | null = null;
  for (const p of index.presets) {
    for (const name of [p.recorded, p.technical?.recorded]) {
      if (!name || !existsSync(path.join(recDir, name))) continue;
      const rec = read<Recorded>("presets", "recorded", name);
      if (!rec.vision || rec.vision.replayed || !rec.engine?.endsWith(":medium")) continue;
      vision.push(rec.vision.ms);
      // A reviewer run read back from a local cache answers in milliseconds; only a live one is a timing.
      const liveReviews = rec.reviews && (rec.reviews.votes ?? []).every((v) => (v.ms ?? 0) > 1000) ? rec.reviews.ms : null;
      if (liveReviews) {
        reviewers.push(liveReviews);
        both.push(rec.vision.ms + liveReviews);
      }
      if (p.id === "sample-charger-cut") flagship = { checkMs: rec.vision.ms, reviewersMs: liveReviews ?? 0 };
    }
  }
  const check = spreadSeconds(vision);
  const withReviewers = spreadSeconds(both);
  return {
    check,
    reviewers: spreadSeconds(reviewers),
    /** The photo check and the two reviewers together, on the runs where the reviewers looked. */
    withReviewers,
    about: Math.round(check.median),
    aboutWithReviewers: Math.round(withReviewers.median),
    flagship,
    sources: [SOURCES.sweep, SOURCES.sample, SOURCES.presets],
  };
}

/**
 * How long a check takes, said the way the recorded runs say it: the photo check alone, and the whole answer when the
 * two reviewers look closer. One sentence for the home page, the flagship example and the README.
 */
export function checkTimeWords(flagshipTotalMs?: number) {
  const ct = checkTimes();
  const f = ct.flagship;
  const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const short = `about ${ct.about} s; about ${ct.aboutWithReviewers} s when the two reviewers look`;
  return {
    about: ct.about,
    withReviewers: ct.aboutWithReviewers,
    /** "about 11 s; about 22 s when the two reviewers look". */
    short,
    /** For the flagship example, a run the two reviewers settled: its own times, then the medians it sits among. */
    flagship:
      f && f.reviewersMs
        ? `This recorded run took ${flagshipTotalMs ? s1(flagshipTotalMs) : s1(f.checkMs + f.reviewersMs)}: the photo check ${s1(f.checkMs)} and the two reviewers ${s1(f.reviewersMs)}${flagshipTotalMs ? ", and the checks in code the rest" : ""}. Across the recorded live runs a check takes ${short}.`
        : null,
  };
}

/**
 * The held-back rate in plain words: how many photos its decisions are on, and why that photo is paid only through the
 * two reviewers (its right-product score sits under the pass mark). Counted from errorRates() and referencePictures().
 */
export function heldBackStory() {
  const e = errorRates().heldBack;
  const refs = referencePictures();
  const scores = [refs.after.preset.c1, ...refs.after.trials.map((t) => t.c1)].filter((x): x is number => x !== null);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const score = lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)} to ${hi.toFixed(2)}`;
  const toPerson = e.misses.reduce((n, m) => n + m.firmReview, 0);
  const photo = e.cases === 1 ? "one photo, the sample charger with its cord cut" : `${e.cases} photos`;
  return {
    count: e.count,
    of: e.of,
    photos: e.cases,
    score,
    pass: LIMITS.productPass.toFixed(2),
    paid: e.of - e.count,
    toPerson,
    sentence: `That is ${e.of} decisions on ${photo}, whose right-product score of ${score} is under the ${LIMITS.productPass.toFixed(2)} pass mark, so only the two reviewers verify it: ${e.of - e.count} of ${e.of}${toPerson ? `, and ${toPerson} went to a person at the firm` : ""}.`,
  };
}

/**
 * The one sentence every page uses for how fast the free picture match answers, from the recorded runs
 * (content/public/verify-runs.json via freeTimings): the hash comparison itself, then the whole answer with reading the
 * photo. Shared so the home page, /evidence and the README cannot drift apart (tests/facts.test.ts).
 */
export function hashSpeed() {
  const t = freeTimings();
  const ms = (n: number) => `${n.toLocaleString("en-US")} ms`;
  return {
    match: t.match,
    answer: t.free,
    sentence: `The hash comparison itself takes a median of ${ms(t.match.median)} (${t.match.min} to ${t.match.max} ms); reading the photo and answering takes a median of ${ms(t.free.median)} (${t.free.min} to ${t.free.max} ms), across ${t.free.n} recorded runs with no model call.`,
    short: `a median of ${ms(t.free.median)} with no model call, the hash comparison itself ${ms(t.match.median)}`,
  };
}

type SampleRefs = { changedAt: string; why: string; before: { images: string[]; sweep: string; preset: string }; after: { images: string[]; sweep: string; preset: string } };

/**
 * The sample recall's reference pictures before and after they changed (content/verify/sample-references.json), with the
 * right-product score (C1) the sample charger with its cord cut got from each set: every sweep trial and the recorded
 * preset, and how each ended.
 */
export function referencePictures() {
  const f = read<SampleRefs>("verify", "sample-references.json");
  const side = (s: SampleRefs["before"]) => {
    const sweep = read<{ ranAt: string; cases: (SweepRow & { C1?: number })[] }>(...s.sweep.replace(/^content\//, "").split("/"));
    const trials = sweep.cases.filter((r) => r.case === "sample-charger-cut").map((r) => ({ trial: r.trial, c1: r.C1 ?? null, decision: r.decision, decidedBy: r.decided_by ?? "" }));
    const preset = read<{ recorded_at: string; decision: string; decided_by: string; vision: { report: { product: { match_score: number } } } }>(...s.preset.replace(/^content\//, "").split("/"));
    return { images: s.images, ranAt: sweep.ranAt, trials, preset: { c1: preset.vision.report.product.match_score, decision: preset.decision, decidedBy: preset.decided_by, recordedAt: preset.recorded_at }, files: [s.sweep, s.preset] };
  };
  return { changedAt: f.changedAt, why: f.why, before: side(f.before), after: side(f.after), file: "content/verify/sample-references.json" };
}
