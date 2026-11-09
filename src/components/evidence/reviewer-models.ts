/**
 * The two reviewers on one model and on two, counted from content/verify/reviewer-models.json, which
 * scripts/verify/sweep.ts --claim-path writes. Server only; every figure is counted from the file's rows each time it is
 * read, and tests/reviewer-models.test.ts checks the comparison the file carries against the same count.
 *
 *  - Run A: both reviewers on Claude Opus 5.5, the default setting.
 *  - Run B: the Remedy reviewer on Claude Sonnet 5.5 (REMEDY_REVIEWER_MODEL_REMEDY), the Product reviewer unchanged.
 *
 * Both runs are the claim path's own code with no model or effort override. Within a trial, B re-reads A's vision
 * report and Product vote from the replay cache (the same request returns the same answer at no charge), so the same
 * photos reach the reviewers in both runs and the Remedy reviewer's model is the only thing that differs.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ModelVote = {
  reviewer: "product" | "remedy";
  /** The model that served the vote, as the API reported it. */
  model: string;
  answer: "meets" | "does_not_meet" | "unclear";
  confidence: number;
  /** Whether the referee's evidence check counted the vote; `set_aside` says why when it did not. */
  counted: boolean;
  set_aside: string | null;
  evidence: { check: string; seen: string; where: string }[];
  model_read?: string | null;
  marker_text_read?: string | null;
  /** True when this run re-read the vote from the replay cache rather than calling the model. */
  replayed?: boolean;
};

export type ModelRow = {
  config: string;
  trial: number;
  case: string;
  known: "paid" | "not_paid" | "reading";
  decision: string;
  decided_by: string;
  referee: "verify" | "person" | null;
  votes: ModelVote[] | null;
  /** List price of every model call this claim made at this setting (vision and reviewers), in US dollars. */
  usd: number;
  /** List price of the two reviewers' calls alone. */
  reviewers_usd: number;
  /** What this run paid: live calls only, since a replayed call costs nothing. */
  paid_usd: number;
};

export type RunSummary = {
  id: string;
  note: string;
  models: { product: string[]; remedy: string[] };
  claims: number;
  /** Claims where both reviewers voted. */
  reviewed: number;
  /** Both reviewers gave the same answer. */
  sameAnswer: number;
  /** The evidence check counted both votes and they gave the same answer (the referee's `agreed`). */
  bothCountedSame: number;
  /** Votes the evidence check set aside (an unclear answer is not counted either, and is not included here). */
  setAside: number;
  /** The referee said pay. */
  refereePaid: number;
  wrongPay: { count: number; of: number };
  wrongHold: { count: number; of: number };
  /** List price of the two reviewers per reviewed claim, in US dollars. */
  reviewerUsdPerReview: number;
  /** List price of a whole check (vision and any reviewers) per claim, in US dollars. */
  usdPerClaim: number;
  /** What this sweep paid for the run (live calls only). */
  paidUsd: number;
};

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
const voteOf = (r: ModelRow, who: ModelVote["reviewer"]) => r.votes?.find((v) => v.reviewer === who);

export function summarizeRun(rows: ModelRow[], id: string, note = ""): RunSummary {
  const mine = rows.filter((r) => r.config === id);
  const reviewed = mine.filter((r) => r.votes?.length === 2);
  const same = (r: ModelRow) => voteOf(r, "product")?.answer === voteOf(r, "remedy")?.answer;
  const notPaid = mine.filter((r) => r.known === "not_paid");
  const paid = mine.filter((r) => r.known === "paid");
  return {
    id,
    note,
    models: { product: uniq(reviewed.map((r) => voteOf(r, "product")?.model ?? "")), remedy: uniq(reviewed.map((r) => voteOf(r, "remedy")?.model ?? "")) },
    claims: mine.length,
    reviewed: reviewed.length,
    sameAnswer: reviewed.filter(same).length,
    bothCountedSame: reviewed.filter((r) => same(r) && r.votes!.every((v) => v.counted)).length,
    setAside: reviewed.reduce((s, r) => s + r.votes!.filter((v) => !v.counted && v.answer !== "unclear").length, 0),
    refereePaid: reviewed.filter((r) => r.referee === "verify").length,
    wrongPay: { count: notPaid.filter((r) => r.decision === "verified").length, of: notPaid.length },
    wrongHold: { count: paid.filter((r) => r.decision !== "verified").length, of: paid.length },
    reviewerUsdPerReview: reviewed.length ? round(reviewed.reduce((s, r) => s + r.reviewers_usd, 0) / reviewed.length) : 0,
    usdPerClaim: mine.length ? round(mine.reduce((s, r) => s + r.usd, 0) / mine.length) : 0,
    paidUsd: round(mine.reduce((s, r) => s + r.paid_usd, 0)),
  };
}

export type Comparison = {
  runs: RunSummary[];
  /** The same photo and trial in both runs, where both reviewers voted in both. */
  pairs: number;
  /** Pairs where the Remedy reviewer's answer differs between the runs. */
  remedyChanged: number;
  /** Pairs where the final decision differs between the runs. */
  decisionChanged: { case: string; trial: number; a: string; b: string }[];
  /** How B's agreement compares with A's, by the share of reviewed claims where the two reviewers gave the same answer. */
  agreement: "more" | "less" | "same";
};

/** A against B, over the rows of a reviewer-models file. */
export function compareReviewerModels(rows: ModelRow[], notes: Record<string, string> = {}): Comparison {
  const [a, b] = ["A", "B"].map((id) => summarizeRun(rows, id, notes[id] ?? ""));
  const key = (r: ModelRow) => `${r.case}|${r.trial}`;
  const inB = new Map(rows.filter((r) => r.config === "B").map((r) => [key(r), r]));
  const pairs = rows.filter((r) => r.config === "A" && r.votes?.length === 2).flatMap((r) => {
    const other = inB.get(key(r));
    return other?.votes?.length === 2 ? [[r, other] as const] : [];
  });
  const rateA = a.reviewed ? a.sameAnswer / a.reviewed : 0;
  const rateB = b.reviewed ? b.sameAnswer / b.reviewed : 0;
  return {
    runs: [a, b],
    pairs: pairs.length,
    remedyChanged: pairs.filter(([x, y]) => voteOf(x, "remedy")?.answer !== voteOf(y, "remedy")?.answer).length,
    decisionChanged: pairs.filter(([x, y]) => x.decision !== y.decision).map(([x, y]) => ({ case: x.case, trial: x.trial, a: x.decision, b: y.decision })),
    agreement: rateB > rateA ? "more" : rateB < rateA ? "less" : "same",
  };
}

export type ReviewerModelsFile = {
  ranAt: string;
  trials: number;
  configs: { id: string; note: string; env?: Record<string, string> }[];
  stopped: string | null;
  cases: ModelRow[];
  comparison: Comparison;
  /** Spend the ai_usage table logged over the run. */
  aiUsage: { since: string; usd: number; calls: number } | null;
  spentUsd: number;
  note?: string;
};

export const REVIEWER_MODELS_FILE = path.join("content", "verify", "reviewer-models.json");

/** The recorded file, or null before the first run. */
export function reviewerModels(root = process.cwd()): ReviewerModelsFile | null {
  const p = path.join(root, REVIEWER_MODELS_FILE);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as ReviewerModelsFile) : null;
}
