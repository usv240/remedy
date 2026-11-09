/**
 * The six checks as the firm console shows them: a short name, one status word per check, and a confidence.
 * Safe for client components (no server code). The checks themselves come from the verification engine
 * (src/lib/verify); this file only reads what it stored on the claim.
 */
import type { CheckId, CheckResult, CheckStatus } from "@/lib/verify/types";

export const CHECK_ORDER: readonly CheckId[] = ["C1", "C2", "C3", "C4", "C5", "C6"];

/** Short names for a grid column header, long names for the drawer. */
export const CHECK_LABEL: Record<CheckId, { short: string; long: string }> = {
  C1: { short: "Product", long: "Right product" },
  C2: { short: "Safe", long: "Made safe" },
  C3: { short: "Own photo", long: "Their own photo" },
  C4: { short: "In recall", long: "Within the recall" },
  C5: { short: "Limits", long: "Claim limits" },
  C6: { short: "Not paid", long: "Not already refunded" },
};

export type CheckWord = CheckStatus | "none";

/** One plain word per status. Neutral words: an unclear check is "Unsure", never a problem with the person. */
export const WORD: Record<CheckWord, string> = {
  pass: "Pass",
  fail: "No",
  unclear: "Unsure",
  skipped: "Skipped",
  unavailable: "Waiting",
  none: "None",
};

/** The pill tone for a status word. */
export const TONE: Record<CheckWord, "positive" | "attention" | "info" | "neutral"> = {
  pass: "positive",
  fail: "attention",
  unclear: "info",
  skipped: "neutral",
  unavailable: "neutral",
  none: "neutral",
};

type StoredChecks = Partial<Record<CheckId, Partial<CheckResult>>> | null | undefined;

/** The status of each check, "none" where the claim has not been checked. */
export function checkWords(checks: StoredChecks): Record<CheckId, CheckWord> {
  const out = {} as Record<CheckId, CheckWord>;
  for (const id of CHECK_ORDER) {
    const s = checks?.[id]?.status;
    out[id] = s === "pass" || s === "fail" || s === "unclear" || s === "skipped" || s === "unavailable" ? s : "none";
  }
  return out;
}

/**
 * Confidence in the photo, 0 to 1: the lower of the right-product (C1) and made-safe (C2) scores, the two judgements
 * the model makes. Null when neither has a score (not checked, or decided before vision ran).
 */
export function confidence(checks: StoredChecks): number | null {
  const scores = (["C1", "C2"] as const).map((id) => checks?.[id]?.score).filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (!scores.length) return null;
  return Math.round(Math.min(...scores) * 100) / 100;
}

/**
 * What the two reviewers did with a claim, so the queue reads from left to right: an unsure check, its confidence, the
 * reviewers, then the decision. From the stored debate (claim.debate, the referee's decision and whether the two counted
 * votes agreed) and who decided (claim.result.decided_by):
 * - agreed: both reviewers found the recalled product made safe, so code verified it (decide() in src/lib/verify/decide.ts
 *   verifies over soft items only when the two agree);
 * - agreed_not: both found the photo does not show it yet, so a person looks;
 * - disagreed: the two counted votes differed, or one was set aside, so a person looks;
 * - not_settled: the reviewers looked and a person was asked to decide; this run kept no votes;
 * - not_needed: the checks settled the claim without them.
 */
export type ReviewersWord = "agreed" | "agreed_not" | "disagreed" | "not_settled" | "not_needed";

export function reviewersOutcome(r: { decision: string; decidedBy: string | null; refereeDecision: string | null; refereeAgreed: boolean | null }): ReviewersWord {
  if (r.refereeDecision === "verify" || (r.decidedBy === "reviewers" && r.decision === "verified")) return "agreed";
  if (r.refereeDecision === "person") return r.refereeAgreed ? "agreed_not" : "disagreed";
  if (r.decidedBy === "reviewers") return "not_settled";
  return "not_needed";
}

export const REVIEWERS_LABEL: Record<ReviewersWord, string> = {
  agreed: "Agreed",
  agreed_not: "Agreed: not yet",
  disagreed: "Disagreed",
  not_settled: "Not settled",
  not_needed: "Not needed",
};

/** One sentence per outcome, for the cell's tooltip and the phone card. */
export const REVIEWERS_PLAIN: Record<ReviewersWord, string> = {
  agreed: "Both reviewers found the recalled product made safe, so code verified it.",
  agreed_not: "Both reviewers found the photo does not show it yet, so a person at the firm decides.",
  disagreed: "The two reviewers did not agree, so a person at the firm decides.",
  not_settled: "The two reviewers looked and did not settle it, so a person at the firm decides.",
  not_needed: "The checks settled this claim without the two reviewers.",
};

export const REVIEWERS_TONE: Record<ReviewersWord, "positive" | "attention" | "info" | "neutral"> = {
  agreed: "positive",
  agreed_not: "attention",
  disagreed: "attention",
  not_settled: "attention",
  not_needed: "neutral",
};

/** How many of the six checks passed, for a phone card ("5 of 6 checks pass"). */
export const passCount = (words: Record<CheckId, CheckWord>) => CHECK_ORDER.filter((id) => words[id] === "pass").length;

/**
 * A check the photo check left unsure and the two reviewers then settled: when both reviewers agreed the recalled
 * product is shown made safe (the recorded outcome, reviewersOutcome above), the unsure Right product check reads as
 * confirmed by them, not "Unsure". The photo check's own score stays on the claim, in the Technical view.
 */
export const SETTLED_WORD = "Confirmed by reviewers";
export const settledByReviewers = (id: CheckId, word: CheckWord, reviewers: ReviewersWord) => id === "C1" && word === "unclear" && reviewers === "agreed";

/** The word and tone a check shows on a claim, with the reviewers' outcome taken into account. */
export function shownCheck(id: CheckId, word: CheckWord, reviewers: ReviewersWord): { word: string; tone: (typeof TONE)[CheckWord]; settled: boolean } {
  if (settledByReviewers(id, word, reviewers)) return { word: SETTLED_WORD, tone: "positive", settled: true };
  return { word: WORD[word], tone: TONE[word], settled: false };
}

/** "5 of 6 checks pass" and, when the reviewers settled the unsure one, that they did. */
export function checksLine(words: Record<CheckId, CheckWord>, reviewers: ReviewersWord): string {
  const settled = CHECK_ORDER.filter((id) => settledByReviewers(id, words[id], reviewers));
  return `${passCount(words)} of 6 checks pass${settled.length ? `, ${settled.join(" and ")} ${SETTLED_WORD.toLowerCase()}` : ""}`;
}
