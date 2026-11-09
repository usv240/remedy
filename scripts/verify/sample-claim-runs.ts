/**
 * The recorded runs the sample firm's sample claims show: every check, score, decision and reviewer vote a seeded claim
 * carries comes from one of these, never from a random draw. Writes src/lib/firm/samples/claim-runs.json.
 *
 *   npx tsx scripts/verify/sample-claim-runs.ts
 *
 * No model call and no network. Two kinds of recording are read:
 * - content/presets/recorded/sample-charger-cut.json: the sample charger with its cord cut, one recorded live answer
 *   (vision and both reviewers). It is replayed through the verifier exactly as /try replays it, so every check is the
 *   engine's own output for that answer.
 * - content/verify/sweep-sample.json: the sample recall's measured sweep (three trials of three photos at the claim
 *   path's setting). Each row keeps the decision, each check's status, the right-product score and the model's reasons;
 *   a check is rebuilt from those fields, with the engine's plain words for that status. Fields a row did not keep (the
 *   reviewers' own votes) are left out, never filled in.
 *
 * tests/sample-claims.test.ts builds the runs again and fails when the committed file differs from the recordings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getRecall, ruleFor, verifyRecallFor } from "../../src/app/api/claims/_lib/recall";
import { DEFAULT_TERMS } from "../../src/app/api/claims/_lib/terms";
import { SHOP } from "../../src/lib/payments/shop-catalog";
import { getPreset, presetPhoto, readRecorded } from "../../src/app/api/try/_lib/presets";
import { verifyPhoto } from "../../src/lib/verify";
import { CHECK_NAMES, evaluateC1, evaluateC2 } from "../../src/lib/verify/checks";
import type { VisionReport } from "../../src/lib/verify/vision-schema";
import type { SamplePhoto, SampleRun, SampleRunsFile, StoredCheck } from "../../src/lib/firm/samples/types";
import type { CheckId, CheckResult, CheckStatus, Checks } from "../../src/lib/verify/types";

const ROOT = process.cwd();
export const RUNS_FILE = path.join(ROOT, "src", "lib", "firm", "samples", "claim-runs.json");
const PRESET_ID = "sample-charger-cut";
const PRESET_FILE = "content/presets/recorded/sample-charger-cut.json";
const SWEEP_FILE = "content/verify/sweep-sample.json";

export type { SamplePhoto, SampleRun, SampleRunsFile } from "../../src/lib/firm/samples/types";

type SweepRow = {
  config: string;
  trial: number;
  case: string;
  decision: SampleRun["decision"];
  decided_by: string;
  C1: number | string;
  C1_status: CheckStatus;
  C2: CheckStatus;
  C3: CheckStatus;
  C4: CheckStatus;
  C1_reason: string;
  C2_reason: string;
  C3_reason: string;
  referee: string | null;
};
type Sweep = { ranAt: string; configs: { id: string; model: string }[]; cases: SweepRow[] };

const SWEEP_PHOTO: Record<string, SamplePhoto> = {
  "sample-charger-cut": "made_safe",
  "sample-charger-opened-cord-attached": "opened",
  "sample-charger-opened-case": "opened_case",
};

const strip = (c: CheckResult): StoredCheck => ({
  id: c.id,
  name: c.name,
  pass: c.pass,
  status: c.status,
  ...(typeof c.score === "number" ? { score: c.score } : {}),
  reason_plain: c.reason_plain,
  reason_technical: c.reason_technical,
});

/** A sweep row keeps each reason cut short (400 or 240 characters): end it at the last whole sentence. */
function wholeSentences(s: string, stopAt?: RegExp): string {
  const cut = stopAt ? s.split(stopAt)[0] : s;
  const t = cut.trim();
  if (/[.)]$/.test(t)) return t;
  const end = t.lastIndexOf(". ");
  return end > 0 ? t.slice(0, end + 1) : t;
}

/** The replay of the one recorded live answer for the sample charger with its cord cut, as /try runs it. */
async function presetRun(): Promise<SampleRun> {
  const p = getPreset(PRESET_ID);
  if (!p) throw new Error(`Preset ${PRESET_ID} is missing from content/presets/index.json.`);
  const rec = readRecorded(p.recorded);
  if (!rec?.vision) throw new Error(`${PRESET_FILE} has no recorded vision answer.`);
  const recall = getRecall(p.recall)!;
  const r = await verifyPhoto(
    {
      photo: presetPhoto(p).bytes,
      recall: verifyRecallFor(recall),
      proofRule: ruleFor(recall).rule,
      // The sample firm's refund on its sample recall: the sample shop's price for the charger, what every sample claim pays.
      claimContext: { firmAmount: { value: (SHOP.product.priceCents / 100).toFixed(2), currency: "USD" }, autoCap: { value: (DEFAULT_TERMS.autoCapCents / 100).toFixed(2), currency: "USD" }, firmName: "Brightline Home" },
      options: { cache: false },
    },
    { aiAvailable: () => false, cache: null, vision: async () => ({ ...rec.vision!, replayed: true }), reviewers: rec.reviews ? async () => rec.reviews! : undefined },
  );
  const checks = Object.fromEntries((Object.keys(r.checks) as CheckId[]).map((id) => [id, strip(r.checks[id])])) as SampleRun["checks"];
  // The review as the claim route stores it (debatePayload), with the recorded reviewers' own time.
  const review = r.review ? { ...r.review, ms: rec.reviews?.ms ?? null } : null;
  return {
    id: "cut-verified",
    photo: "made_safe",
    from: { file: PRESET_FILE, at: "the recorded vision answer and both reviewers' votes, replayed through the verifier", trial: null, recordedAt: rec.recorded_at },
    model: rec.vision.model,
    decision: r.decision as SampleRun["decision"],
    decidedBy: r.decided_by,
    checks,
    summary: { plain: r.summary.plain, technical: r.summary.technical.replace(/ Model answers read from the verification cache \([^)]*\), so no model call was made for them\./, "") },
    review,
  };
}

/** One sweep row as a run: each check rebuilt from the fields the row kept, with the engine's words for its status. */
function sweepRun(row: SweepRow, codeChecks: Pick<Checks, "C5" | "C6">, sweep: Sweep): SampleRun {
  const photo = SWEEP_PHOTO[row.case];
  if (!photo) throw new Error(`No sample photo for sweep case ${row.case}.`);
  const score = typeof row.C1 === "number" ? row.C1 : null;
  if (score === null) throw new Error(`Sweep row ${row.case} #${row.trial} has no right-product score.`);
  // The engine's own wording for each status: the same functions the claim path calls, fed the recorded reading.
  const c1 = evaluateC1({ product: { match_score: score, matching_details: [], differing_details: [], reason_plain: "", reason_technical: "" } } as unknown as VisionReport);
  if (c1.status !== row.C1_status) throw new Error(`Sweep row ${row.case} #${row.trial}: score ${score} reads ${c1.status}, the row says ${row.C1_status}.`);
  const done = row.C2 === "pass";
  const c2 = evaluateC2({ actions: [{ action: "cut_cord", done, confidence: done ? 0.9 : 0, evidence: "" }], handwritten_text: [] } as unknown as VisionReport, { actions: ["cut_cord"] } as never);
  if (c2.status !== row.C2) throw new Error(`Sweep row ${row.case} #${row.trial}: made-safe reads ${c2.status}, the row says ${row.C2}.`);
  const own = /confidence ([\d.]+)/.exec(row.C3_reason);
  if (row.C3 !== "pass" || !own) throw new Error(`Sweep row ${row.case} #${row.trial}: own-photo check is ${row.C3}; only a camera photo that passed is rebuilt.`);
  if (row.C4 !== "pass") throw new Error(`Sweep row ${row.case} #${row.trial}: the within-recall check is ${row.C4}.`);
  const mk = (id: CheckId, status: CheckStatus, plain: string, technical: string, s?: number): StoredCheck => ({ id, name: CHECK_NAMES[id], pass: status === "pass", status, ...(s !== undefined ? { score: s } : {}), reason_plain: plain, reason_technical: technical });
  const checks: SampleRun["checks"] = {
    C1: mk("C1", c1.status, c1.reason_plain, wholeSentences(row.C1_reason), score),
    C2: mk("C2", c2.status, c2.reason_plain, wholeSentences(row.C2_reason)),
    C3: mk("C3", "pass", "This is a new photo of the product.", wholeSentences(row.C3_reason, / dHash /), Number(own[1])),
    C4: mk("C4", "pass", "No model or lot number is needed for this recall.", "The proof rule asks for no model, lot or date code, and nothing read conflicts with the recall."),
    C5: strip(codeChecks.C5),
    C6: strip(codeChecks.C6),
  };
  const summary =
    row.decision === "retake"
      ? { plain: "The photo does not show the product made safe yet, so the owner is asked for one more photo.", technical: `Decided by ${row.decided_by}: the made-safe check did not pass.` }
      : row.decision === "firm_review"
        ? { plain: "The two reviewers did not settle it, so a person at the firm looks.", technical: `Decided by ${row.decided_by}; the referee answered "${row.referee}". This run kept the referee's answer, not each reviewer's vote.` }
        : { plain: "Both reviewers found the recalled product, made safe.", technical: `Decided by ${row.decided_by}.` };
  const config = sweep.configs.find((c) => c.id === row.config);
  return {
    id: `${photo}-${row.decision}-trial-${row.trial}`,
    photo,
    from: { file: SWEEP_FILE, at: `case ${row.case}, setting ${row.config}, trial ${row.trial}`, trial: row.trial, recordedAt: sweep.ranAt },
    model: config?.model ?? "claude-opus-5-5",
    decision: row.decision,
    decidedBy: row.decided_by,
    checks,
    summary,
    review: null,
  };
}

/** Every run the sample claims use, built from the recordings. */
export async function buildSampleRuns(): Promise<SampleRunsFile> {
  const sweep = JSON.parse(readFileSync(path.join(ROOT, SWEEP_FILE), "utf8")) as Sweep;
  const preset = await presetRun();
  const claimPath = sweep.configs[0]?.id;
  const rows = sweep.cases.filter((c) => c.config === claimPath);
  // The photos asked for a new one, every trial; the cord-cut photo's trial the reviewers left to a person.
  const retakes = rows.filter((r) => r.decision === "retake" && SWEEP_PHOTO[r.case] && SWEEP_PHOTO[r.case] !== "made_safe");
  const reviews = rows.filter((r) => r.decision === "firm_review" && SWEEP_PHOTO[r.case] === "made_safe");
  return {
    note: `Written by scripts/verify/sample-claim-runs.ts from ${PRESET_FILE} and ${SWEEP_FILE}. Every check, score, decision and reviewer vote a sample claim shows is one of these recorded runs; no model call was made for any sample claim.`,
    runs: [preset, ...reviews.map((r) => sweepRun(r, preset.checks as unknown as Checks, sweep)), ...retakes.map((r) => sweepRun(r, preset.checks as unknown as Checks, sweep))],
  };
}

async function main() {
  const out = await buildSampleRuns();
  writeFileSync(RUNS_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`sample claim runs: ${out.runs.length} written to ${path.relative(ROOT, RUNS_FILE)}: ${out.runs.map((r) => `${r.id} (C1 ${r.checks.C1.score ?? "none"})`).join(", ")}`);
}

if (process.argv[1] && /sample-claim-runs\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("sample-claim-runs failed:", (e as Error).message);
    process.exit(1);
  });
}
