/**
 * One reviewer against the referee, from the recorded runs at the claim path's setting. Server only; every figure is
 * read from files in the repo each time the page is built.
 *
 * Sources: content/verify/sweep-results.json and content/verify/sweep-sample.json (the config in CLAIM_PATH_CONFIG),
 * and each /try preset's recorded live answer in content/presets/recorded/*.json. The known answers come from
 * content/verify/fixtures/cases.json through knownAnswer() in errors.ts, and from a preset's own expected decision.
 *
 * What the files hold: every row keeps the referee's decision (verify or person) when the two reviewers ran, and the
 * sweep rows written before 2026-11-08 keep the reviewers' token usage but not what each reviewer answered
 * (scripts/verify/sweep.ts now writes `votes`). The recorded preset keeps both votes in full. So "what one reviewer
 * alone would have decided" can be read only where votes were recorded, and the counts below say over how many rows.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CLAIM_PATH_CONFIG, knownAnswer } from "./errors";

const ROOT = process.cwd();
const read = <T>(...p: string[]): T => JSON.parse(readFileSync(path.join(ROOT, "content", ...p), "utf8")) as T;

export type Known = "paid" | "not_paid" | "reading";
export type ReviewerId = "product" | "remedy";
export type RecordedVote = { reviewer: ReviewerId; answer: "meets" | "does_not_meet" | "unclear"; confidence: number; counted: boolean };
export type ReviewedRow = {
  source: "sweep" | "sample" | "preset";
  caseId: string;
  trial: number | null;
  known: Known;
  /** "checks": the six checks settled it before any reviewer ran. "reviewers": the two reviewers and the referee ran. */
  firstPass: "checks" | "reviewers";
  referee: "verify" | "person" | null;
  decision: string;
  /** Each reviewer's own answer, when the file kept it; null where only the referee's decision was recorded. */
  votes: RecordedVote[] | null;
};

type Expect = { decision?: string; not_decision?: string; checks?: Record<string, string> };
type Case = { id: string; photo: string; recall: string; official_hash_check?: boolean; expect: Expect };
type SweepRow = { config: string; trial: number; case: string; decision: string; decided_by?: string; referee: string | null; votes?: RecordedVote[] | null };
type PresetIndex = { presets: { id: string; recall: string; photo: string; expected: Expect; recorded?: string; technical?: { recorded: string; options: { officialHashCheck?: boolean } } }[] };
type Recording = { decision: string; decided_by: string; vision: unknown | null; reviews: { decision: "verify" | "person"; votes: RecordedVote[] } | null };

const known = (e: Expect | undefined, photo: string | undefined): Known => knownAnswer(e, photo) ?? "reading";

/** Every recorded decision at the claim path's setting, in the order the files hold them. */
export function reviewedRows(config = CLAIM_PATH_CONFIG): ReviewedRow[] {
  const cases = read<{ cases: Case[] }>("verify", "fixtures", "cases.json").cases;
  const byId = new Map(cases.map((c) => [c.id, c]));
  const out: ReviewedRow[] = [];
  const fromSweep = (file: string, source: "sweep" | "sample") => {
    const p = path.join(ROOT, "content", "verify", file);
    if (!existsSync(p)) return;
    for (const r of read<{ cases: SweepRow[] }>("verify", file).cases) {
      if (r.config !== config) continue;
      const c = byId.get(r.case);
      const reached = r.decided_by === "reviewers";
      out.push({
        source,
        caseId: r.case,
        trial: r.trial,
        known: known(c?.expect, c?.photo),
        firstPass: reached ? "reviewers" : "checks",
        referee: reached ? ((r.referee as "verify" | "person" | null) ?? null) : null,
        decision: r.decision,
        votes: reached && Array.isArray(r.votes) && r.votes.length ? r.votes : null,
      });
    }
  };
  fromSweep("sweep-results.json", "sweep");
  fromSweep("sweep-sample.json", "sample");

  const index = read<PresetIndex>("presets", "index.json");
  const recDir = path.join(ROOT, "content", "presets", "recorded");
  const onDisk = new Set(existsSync(recDir) ? readdirSync(recDir) : []);
  for (const p of index.presets) {
    for (const [name, hashOff, own] of [
      [p.recorded, false, p.expected],
      [p.technical?.recorded, p.technical?.options.officialHashCheck === false, undefined],
    ] as const) {
      if (!name || !onDisk.has(name)) continue;
      const rec = read<Recording>("presets", "recorded", name);
      if (!rec.vision) continue;
      const c = cases.find((x) => x.recall === p.recall && x.photo === p.photo && (x.official_hash_check === false) === hashOff);
      const reached = rec.decided_by === "reviewers";
      const votes = reached && rec.reviews?.votes?.length ? rec.reviews.votes.map((v) => ({ reviewer: v.reviewer, answer: v.answer, confidence: v.confidence, counted: v.counted })) : null;
      out.push({ source: "preset", caseId: c?.id ?? p.id, trial: null, known: known(own?.decision ? own : c?.expect, p.photo), firstPass: reached ? "reviewers" : "checks", referee: reached ? (rec.reviews?.decision ?? null) : null, decision: rec.decision, votes });
    }
  }
  return out;
}

export type Tally = { wrongPay: number; notPaid: number; wrongHold: number; paid: number; rows: number };

const tally = (rows: ReviewedRow[], pays: (r: ReviewedRow) => boolean): Tally => {
  const money = rows.filter((r) => r.known !== "reading");
  const notPaid = money.filter((r) => r.known === "not_paid");
  const paid = money.filter((r) => r.known === "paid");
  return { wrongPay: notPaid.filter(pays).length, notPaid: notPaid.length, wrongHold: paid.filter((r) => !pays(r)).length, paid: paid.length, rows: rows.length };
};

/** Paying on one reviewer's word alone: its vote says meets and was counted by the evidence check. */
export const aloneWouldPay = (r: ReviewedRow, who: ReviewerId): boolean => {
  const v = r.votes?.find((x) => x.reviewer === who);
  return Boolean(v && v.answer === "meets" && v.counted);
};

/**
 * The comparison: the rows the two reviewers saw, what the referee did with them, and what each reviewer alone would
 * have done on the rows whose votes were kept.
 */
export function reviewerComparison(config = CLAIM_PATH_CONFIG) {
  const rows = reviewedRows(config);
  const reached = rows.filter((r) => r.firstPass === "reviewers");
  const withVotes = reached.filter((r) => r.votes);
  const referee = tally(reached, (r) => r.decision === "verified");
  const alone = (who: ReviewerId) => ({ who, ...tally(withVotes, (r) => aloneWouldPay(r, who)) });
  const product = alone("product");
  const remedy = alone("remedy");
  // On the rows with recorded votes: did paying on either reviewer alone change any payment the referee made?
  const refereeOnVoted = tally(withVotes, (r) => r.decision === "verified");
  const same = withVotes.every((r) => aloneWouldPay(r, "product") === (r.decision === "verified") && aloneWouldPay(r, "remedy") === (r.decision === "verified"));
  return {
    config,
    rows,
    reached,
    settled: rows.length - reached.length,
    withVotes: withVotes.length,
    referee,
    refereeOnVoted,
    product,
    remedy,
    /** True when, on every row with recorded votes, each reviewer alone would have paid exactly what the referee paid. */
    sameAsReferee: same,
    sources: ["content/verify/sweep-results.json", "content/verify/sweep-sample.json", "content/presets/recorded/*.json", "content/verify/fixtures/cases.json"],
  };
}
