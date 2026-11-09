/**
 * The one source for the figures the README, TESTING.md and /evidence repeat: writes content/public/facts.json.
 *
 *   npx tsx scripts/facts.ts              runs the unit tests (no network, no AI) and counts them, then the rest
 *   npx tsx scripts/facts.ts --no-tests   keeps the unit-test figures already in the file
 *
 * Unit tests: counted from vitest's own JSON report of this run. Accessibility: the tally tests/e2e/pages-a11y.mjs
 * wrote at its last run (content/public/a11y.json). MCP tools: src/lib/mcp/tools.ts. Photo checks and error rates:
 * src/components/evidence/errors.ts, from the recorded runs. The catalog of distinct published pictures:
 * src/lib/verify/dhash.ts. Payout timing: payoutTiming() over content/public/measured.json and the e2e transcript; photo check timing: checkTimes() over every recorded
 * live call. The hosted AI budget: render.yaml. tests/facts.test.ts fails when the README, docs/*.md or TESTING.md
 * disagree with this file, or when this file disagrees with the code.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { answerChanges, checkTimes, errorRates, freeCaught, freeTimings, hashSpeed, readingAccuracy, referencePictures, sweepSettings } from "../src/components/evidence/errors";
import { hostedDailyUsd } from "../src/lib/ai/hosted-budget";
import { photoAsk } from "../src/lib/recall/photo-count";
import { proofSplit, type SplitRecall, type SplitRule } from "../src/lib/recall/made-safe";
import { moneyWords, recallValue, type ValueRecall } from "../src/lib/recall/value";
import { TOOLS } from "../src/lib/mcp/tools";
import { payoutTiming } from "../src/lib/payout-timing";
import { catalogCounts, catalogOfficialHashes } from "../src/lib/verify/dhash";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "content", "public", "facts.json");
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

/** What a skipped test needs to run: a database, a Claude key, or PayPal sandbox keys. */
export type SkipNeeds = { database: number; claude: number; paypal: number; other: number };
type UnitTests = { passed: number; skipped: number; skippedNeeds: SkipNeeds; failed: number; files: number; testsHash: string; ranAt: string; note: string };
type Facts = {
  note: string;
  writtenAt: string;
  unitTests: UnitTests;
  a11y: { pages: number; views: number; passed: number; ranAt: string } | null;
  mcp: { tools: number; names: string[] };
  photoChecks: { freeCaught: number; freeTotal: number };
  errors: { wrongPay: { count: number; of: number; photos: number }; heldBack: { count: number; of: number; photos: number }; decisions: number; photos: number };
  catalogPictures: number;
  /** The same catalog in full: pictures stored, distinct hash values among them, and the pictures distinct enough to tell their recall apart. */
  catalog: { stored: number; distinctHashes: number; catalog: number };
  measured: { checkSeconds: number | null; payoutSeconds: number | null };
  /** The payout from approval to SUCCESS: its range and run count over both records (src/lib/payout-timing.ts). */
  payout: { min: number; max: number; runs: number; figure: string } | null;
  /** The free answers' times, from the recorded runs (content/public/verify-runs.json): the whole answer and the hash comparison. */
  timings: { free: Spread; match: Spread; recordedAt: string; sentence: string };
  /** A live photo check at the claim path's setting, in seconds, from every recorded live call (checkTimes). */
  checkTimes: { check: Spread; reviewers: Spread; about: number; flagship: { checkMs: number; reviewersMs: number } | null };
  /** The hosted site's daily Claude budget, from render.yaml. */
  hostedAiDailyUsd: number | null;
  /** Known answers revised after the sweep (content/verify/answer-changes.json). */
  answerChanges: { count: number; cases: string[] };
  /** The sample charger's right-product score before and after its recall's reference pictures changed. */
  references: { changedAt: string; before: (number | null)[]; after: (number | null)[]; afterVerified: number };
  /** One photo, two firms (content/public/network-run.json). */
  network: { firstFirm: string; secondFirm: string; decision: string; decidedBy: string; reachedModel: boolean; controlReachedModel: boolean; crossed: string[]; totalMs: number };
  /** What the model read on the CPSC's own made-safe photos, at the claim path's setting. */
  reading: { right: number; readings: number; product: number; madeSafe: number; trials: number; photos: number };
  /** The sweep's four settings, money first; then right as scored the day it ran (atSweep), then re-scored (correct). */
  settings: { id: string; wrongPay: string; atSweep: string; correct: string; usdPerCase: number }[];
  /** Photo-refund remedies that ask for more than one photo (src/lib/recall/photo-count.ts). */
  multiPhoto: { count: number; of: number; numbers: string[] };
  /** What the photo-refund recalls are worth to their owners (content/recalls/value.json). */
  value: { covered: number; recalls: number; proRated: number; noPrice: number; total: string; unclaimed: string; unclaimedAtCorrection: string; correctionRate: string; perPoint: string };
  /** The headline count, and what the other photo-refund recalls ask for (content/recalls/proof-split.json). */
  headline: { recalls: number; photoRefund: number; madeSafeRefund: number; share: number; byYear: Record<string, number>; madeSafeCredit: number; otherPhoto: number; noPhoto: number };
  /** The first and latest commit dates, US Eastern time, from git: the README's history sentence. */
  history: { first: string; latest: string; latestCommit: string; sentence: string } | null;
};
type Spread = { median: number; min: number; max: number; n: number };

function unitTests(): UnitTests {
  const dir = mkdtempSync(path.join(tmpdir(), "remedy-facts-"));
  const report = path.join(dir, "vitest.json");
  try {
    // Without keys or a database, as CI runs them: the live Claude, live PayPal and Postgres suites skip.
    const env: NodeJS.ProcessEnv = { ...process.env, REMEDY_FACTS_RUN: "1" };
    for (const k of ["DATABASE_URL", "ANTHROPIC_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "SANDBOX_BUYER_EMAIL", "SANDBOX_BUYER_PASSWORD"]) delete env[k];
    const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", "--reporter=json", `--outputFile=${report}`], { cwd: ROOT, env, stdio: "inherit" });
    if (!existsSync(report)) throw new Error(`vitest wrote no report (exit ${r.status})`);
    const j = read<{ numPassedTests: number; numPendingTests: number; numTodoTests: number; numFailedTests: number; testResults: { name: string; assertionResults: { status: string }[] }[]; startTime: number }>(report);
    const needs: SkipNeeds = { database: 0, claude: 0, paypal: 0, other: 0 };
    for (const f of j.testResults) for (const a of f.assertionResults) if (a.status === "pending" || a.status === "skipped" || a.status === "todo") needs[skipNeed(path.basename(f.name))]++;
    return {
      passed: j.numPassedTests,
      skipped: j.numPendingTests + j.numTodoTests,
      skippedNeeds: needs,
      failed: j.numFailedTests,
      files: j.testResults.length,
      testsHash: testsHash(),
      ranAt: new Date(j.startTime).toISOString(),
      note: "npm test with no keys and no database, as CI runs it. The skipped tests need a Postgres database, a Claude key or PayPal sandbox keys, counted by what each needs (skipNeed).",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The live suites, by file. Every other suite that skips needs a database (describe.skipIf(!DATABASE_URL)). */
const NEEDS_KEY: Record<string, keyof SkipNeeds> = { "verify.live.test.ts": "claude", "payments.live.test.ts": "paypal" };
const NEEDS_DB = /\.pg\.test\.ts$|^(firm-limits|jobs|photo-privacy|ratelimit|sample-claims)\.test\.ts$/;
export const skipNeed = (file: string): keyof SkipNeeds => NEEDS_KEY[file] ?? (NEEDS_DB.test(file) ? "database" : "other");

/**
 * A fingerprint of every unit test file (line endings normalized), so tests/facts.test.ts can tell when a test was
 * added or changed after the counts were taken: they then need `npx tsx scripts/facts.ts` again.
 */
export function testsHash(): string {
  const dir = path.join(ROOT, "tests");
  const h = createHash("sha256");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".test.ts")).sort()) h.update(f).update(readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex").slice(0, 16);
}

/** The figures counted from the recorded runs, the sweep and the CPSC data: no tests, no network. Shared with tests/facts.test.ts. */
export function derived() {
  const t = freeTimings();
  const ct = checkTimes();
  const refs = referencePictures();
  const net = JSON.parse(readFileSync(path.join(ROOT, "content", "public", "network-run.json"), "utf8")) as {
    first: { firm: string };
    second: { firm: string; decision: string; decided_by: string; reached_model: boolean; timings: { total_ms: number } };
    control: { reached_model: boolean };
    crossed: { fields: string[] };
  };
  const ra = readingAccuracy();
  const recalls = read<{ recalls: (ValueRecall & SplitRecall & { remedyText: string })[] }>(path.join(ROOT, "content", "recalls", "recalls.json")).recalls;
  const rules = read<{ rules: Record<string, SplitRule> }>(path.join(ROOT, "content", "recalls", "proof-rules.json")).rules;
  const pr = recalls.filter((r) => r.photoRefund);
  const multi = pr.filter((r) => photoAsk(r.remedyText).count > 1).map((r) => r.number);
  const v = recallValue(recalls, rules);
  const split = proofSplit(recalls, rules);
  return {
    timings: { free: t.free, match: t.match, recordedAt: t.recordedAt, sentence: hashSpeed().sentence },
    checkTimes: { check: ct.check, reviewers: ct.reviewers, about: ct.about, flagship: ct.flagship },
    hostedAiDailyUsd: hostedDailyUsd(),
    answerChanges: { count: answerChanges().length, cases: answerChanges().map((a) => a.case) },
    references: {
      changedAt: refs.changedAt,
      before: [refs.before.preset.c1, ...refs.before.trials.map((x) => x.c1)],
      after: [refs.after.preset.c1, ...refs.after.trials.map((x) => x.c1)],
      afterVerified: [refs.after.preset, ...refs.after.trials].filter((x) => x.decision === "verified").length,
    },
    network: {
      firstFirm: net.first.firm,
      secondFirm: net.second.firm,
      decision: net.second.decision,
      decidedBy: net.second.decided_by,
      reachedModel: net.second.reached_model,
      controlReachedModel: net.control.reached_model,
      crossed: net.crossed.fields,
      totalMs: net.second.timings.total_ms,
    },
    reading: { right: ra.right, readings: ra.readings, product: ra.product, madeSafe: ra.madeSafe, trials: ra.trials, photos: ra.photos },
    settings: sweepSettings().map((s) => ({ id: s.id, wrongPay: `${s.wrongPay.count} of ${s.wrongPay.of}`, atSweep: `${s.atSweep.count} of ${s.atSweep.of}`, correct: `${s.correct.count} of ${s.correct.of}`, usdPerCase: s.usdPerCase })),
    multiPhoto: { count: multi.length, of: pr.length, numbers: multi },
    value: {
      covered: v.covered,
      recalls: v.recalls,
      proRated: v.proRated.count,
      noPrice: v.noPrice,
      total: moneyWords(v.lowUsd),
      unclaimed: moneyWords(v.unclaimedLowUsd),
      unclaimedAtCorrection: moneyWords(v.unclaimedAtCorrectionLowUsd),
      correctionRate: `${(v.correctionRate * 100).toFixed(2)}%`,
      perPoint: moneyWords(v.perPointLowUsd),
    },
    headline: {
      recalls: split.recalls,
      photoRefund: split.photoRefund,
      madeSafeRefund: split.madeSafeRefund.count,
      share: split.madeSafeRefund.share,
      byYear: split.madeSafeRefund.byYear,
      madeSafeCredit: split.madeSafeCredit.count,
      otherPhoto: split.otherPhoto.count,
      noPhoto: split.noPhoto.count,
    },
  };
}

/** The first and latest commit, from git, dated in US Eastern time; the last written ones when git is not there. */
function history(before: Facts | null): Facts["history"] {
  const git = (args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  const first = git(["log", "--reverse", "--format=%cI"]).stdout?.split("\n")[0]?.trim();
  const [latest, commit] = (git(["log", "-1", "--format=%cI %h"]).stdout ?? "").trim().split(" ");
  if (!first || !latest || !commit) return before?.history ?? null;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  return { first: day(first), latest: day(latest), latestCommit: commit, sentence: `History: the first commit is dated ${day(first)} and the latest ${day(latest)}.` };
}

function main() {
  const before = existsSync(OUT) ? read<Facts>(OUT) : null;
  const ran = process.argv.includes("--no-tests") && before ? before.unitTests : unitTests();
  // A run with a failing test never becomes the published count: a test that timed out on a busy machine would
  // otherwise lower the passed figure /evidence prints below the one the README states. Keep the last clean count.
  if (ran.failed && before) console.error(`facts: ${ran.failed} unit tests FAILED in this run, so the unit-test figures stay at the last clean run (${before.unitTests.passed} passed). Fix the failure and run again.`);
  const tests = ran.failed && before ? before.unitTests : ran;
  const a11yFile = path.join(ROOT, "content", "public", "a11y.json");
  const a11y = existsSync(a11yFile) ? read<{ pages: number; views: number; passed: number; ranAt: string }>(a11yFile) : null;
  const e = errorRates();
  const free = freeCaught();
  const pt = payoutTiming();
  const facts: Facts = {
    note: "Written by scripts/facts.ts. The one source for figures the README, TESTING.md and /evidence repeat; tests/facts.test.ts checks them against it and against the code.",
    writtenAt: new Date().toISOString(),
    unitTests: tests,
    a11y: a11y ? { pages: a11y.pages, views: a11y.views, passed: a11y.passed, ranAt: a11y.ranAt } : null,
    mcp: { tools: TOOLS.length, names: TOOLS.map((t) => t.name) },
    photoChecks: { freeCaught: free.caught, freeTotal: free.total },
    errors: {
      wrongPay: { count: e.wrongPay.count, of: e.wrongPay.of, photos: e.wrongPay.cases },
      heldBack: { count: e.heldBack.count, of: e.heldBack.of, photos: e.heldBack.cases },
      decisions: e.decisions,
      photos: e.photos,
    },
    catalogPictures: catalogOfficialHashes().length,
    catalog: catalogCounts(),
    measured: { checkSeconds: checkTimes().about, payoutSeconds: pt?.about ?? null },
    payout: pt ? { min: pt.min, max: pt.max, runs: pt.runs, figure: pt.figure } : null,
    ...derived(),
    history: history(before),
  };
  writeFileSync(OUT, JSON.stringify(facts, null, 2) + "\n");
  console.log(
    `facts: ${tests.passed} unit tests passed, ${tests.skipped} skipped (${tests.skippedNeeds?.database} need a database, ${tests.skippedNeeds?.claude} a Claude key, ${tests.skippedNeeds?.paypal} PayPal keys)${tests.failed ? `, ${tests.failed} FAILED` : ""}; a11y ${a11y ? `${a11y.passed} of ${a11y.views} views on ${a11y.pages} pages` : "not run yet"}; ${facts.mcp.tools} MCP tools; ${free.caught} of ${free.total} free cases; paid wrongly ${e.wrongPay.count} of ${e.wrongPay.of}; held back ${e.heldBack.count} of ${e.heldBack.of}; ${facts.catalogPictures} catalog pictures`,
  );
  if (ran.failed) process.exitCode = 1;
}

if (process.argv[1] && /facts\.ts$/.test(process.argv[1])) main();
