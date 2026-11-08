/**
 * The one source for the figures the README, TESTING.md and /evidence repeat: writes content/public/facts.json.
 *
 *   npx tsx scripts/facts.ts              runs the unit tests (no network, no AI) and counts them, then the rest
 *   npx tsx scripts/facts.ts --no-tests   keeps the unit-test figures already in the file
 *
 * Unit tests: counted from vitest's own JSON report of this run. Accessibility: the tally tests/e2e/pages-a11y.mjs
 * wrote at its last run (content/public/a11y.json). MCP tools: src/lib/mcp/tools.ts. Photo checks and error rates:
 * src/components/judges/errors.ts, from the recorded runs. The catalog of distinct published pictures:
 * src/lib/verify/dhash.ts. Payout timing: content/public/measured.json; photo check timing: checkTimes() over every recorded
 * live call. The hosted AI budget: render.yaml. tests/facts.test.ts fails when the README, docs/*.md or TESTING.md
 * disagree with this file, or when this file disagrees with the code.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { answerChanges, checkTimes, errorRates, freeCaught, freeTimings, hashSpeed, readingAccuracy, referencePictures, sweepSettings } from "../src/components/judges/errors";
import { hostedDailyUsd } from "../src/lib/ai/hosted-budget";
import { photoAsk } from "../src/lib/recall/photo-count";
import { moneyWords, recallValue, type ValueRecall } from "../src/lib/recall/value";
import { TOOLS } from "../src/lib/mcp/tools";
import { aboutSeconds } from "../src/lib/research";
import { catalogOfficialHashes } from "../src/lib/verify/dhash";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "content", "public", "facts.json");
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

type UnitTests = { passed: number; skipped: number; failed: number; files: number; ranAt: string; note: string };
type Facts = {
  note: string;
  writtenAt: string;
  unitTests: UnitTests;
  a11y: { pages: number; views: number; passed: number; ranAt: string } | null;
  mcp: { tools: number; names: string[] };
  photoChecks: { freeCaught: number; freeTotal: number };
  errors: { wrongPay: { count: number; of: number; photos: number }; heldBack: { count: number; of: number; photos: number }; decisions: number; photos: number };
  catalogPictures: number;
  measured: { checkSeconds: number | null; payoutSeconds: number | null };
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
  value: { covered: number; recalls: number; total: string; unclaimed: string; perPoint: string };
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
    const j = read<{ numPassedTests: number; numPendingTests: number; numTodoTests: number; numFailedTests: number; numTotalTestSuites: number; testResults: unknown[]; startTime: number }>(report);
    return {
      passed: j.numPassedTests,
      skipped: j.numPendingTests + j.numTodoTests,
      failed: j.numFailedTests,
      files: j.testResults.length,
      ranAt: new Date(j.startTime).toISOString(),
      note: "npm test with no keys and no database, as CI runs it: the live Claude, live PayPal and Postgres suites skip.",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  const recalls = read<{ recalls: (ValueRecall & { remedyText: string })[] }>(path.join(ROOT, "content", "recalls", "recalls.json")).recalls;
  const pr = recalls.filter((r) => r.photoRefund);
  const multi = pr.filter((r) => photoAsk(r.remedyText).count > 1).map((r) => r.number);
  const v = recallValue(recalls);
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
    value: { covered: v.covered, recalls: v.recalls, total: moneyWords(v.lowUsd), unclaimed: moneyWords(v.unclaimedLowUsd), perPoint: moneyWords(v.perPointLowUsd) },
  };
}

function main() {
  const before = existsSync(OUT) ? read<Facts>(OUT) : null;
  const tests = process.argv.includes("--no-tests") && before ? before.unitTests : unitTests();
  const a11yFile = path.join(ROOT, "content", "public", "a11y.json");
  const a11y = existsSync(a11yFile) ? read<{ pages: number; views: number; passed: number; ranAt: string }>(a11yFile) : null;
  const e = errorRates();
  const free = freeCaught();
  const measured = read<{ items: { id: string; figure: string }[] }>(path.join(ROOT, "content", "public", "measured.json")).items;
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
    measured: { checkSeconds: checkTimes().about, payoutSeconds: aboutSeconds(measured.find((m) => m.id === "payout")?.figure) },
    ...derived(),
  };
  writeFileSync(OUT, JSON.stringify(facts, null, 2) + "\n");
  console.log(
    `facts: ${tests.passed} unit tests passed, ${tests.skipped} skipped${tests.failed ? `, ${tests.failed} FAILED` : ""}; a11y ${a11y ? `${a11y.passed} of ${a11y.views} views on ${a11y.pages} pages` : "not run yet"}; ${facts.mcp.tools} MCP tools; ${free.caught} of ${free.total} free cases; paid wrongly ${e.wrongPay.count} of ${e.wrongPay.of}; held back ${e.heldBack.count} of ${e.heldBack.of}; ${facts.catalogPictures} catalog pictures`,
  );
  if (tests.failed) process.exitCode = 1;
}

if (process.argv[1] && /facts\.ts$/.test(process.argv[1])) main();
