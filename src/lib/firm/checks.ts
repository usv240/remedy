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

/** How many of the six checks passed, for a phone card ("5 of 6 checks pass"). */
export const passCount = (words: Record<CheckId, CheckWord>) => CHECK_ORDER.filter((id) => words[id] === "pass").length;
