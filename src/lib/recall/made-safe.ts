/**
 * What each photo-refund recall's photo is for, read from its proof rule (content/recalls/proof-rules.json), not from
 * the remedy's words alone. The classifier (src/lib/recall/classify.ts) counts a recall as photo-refund when its remedy
 * names a photo and a refund; the proof rule then says what the photo must show and what the owner gets:
 *
 *   made_safe   a photo of the product made safe: the rule lists an action (cut the cord, write RECALLED, cut it up)
 *   identifier  a photo of a label, serial, lot or date code on a product the owner keeps or throws away unchanged
 *   product     a photo of the product itself, as proof of ownership
 *   none        the rule finds no photo step (the photo is one proof among others, or for a store visit)
 *
 * The headline counts the made-safe recalls whose rule pays a refund in money (full, partial, or refund or
 * replacement), so a store credit or gift card is never counted as a refund. Pure: the script, the tests and the pages
 * share it.
 */

/** The fields of a stored proof rule this reads (src/lib/recall/proof-rule.ts ProofRule). */
export type SplitRule = {
  photo_required: boolean;
  actions: string[];
  must_show: string[];
  remedy: string;
  refund_amount: number | null;
  refund_amount_text: string | null;
};
export type SplitRecall = { number: string; date: string; photoRefund: boolean };
export type ProofKind = "made_safe" | "identifier" | "product" | "none";

/** Remedies that pay the owner money. "other" is store credit, a gift card, a voucher or nothing for the owner. */
export const REFUND_REMEDIES: readonly string[] = ["full_refund", "partial_refund", "refund_or_replacement"];
const IDENTIFIERS = ["label", "model_number", "serial_or_lot", "date_code"];

export function proofKind(rule: SplitRule): ProofKind {
  if (!rule.photo_required) return "none";
  if (rule.actions.length > 0) return "made_safe";
  if (rule.must_show.some((m) => IDENTIFIERS.includes(m))) return "identifier";
  return "product";
}

export const paysRefund = (rule: SplitRule) => REFUND_REMEDIES.includes(rule.remedy);

/** The headline's recalls: the rule asks for a photo of the product made safe, and pays a refund in money for it. */
export const madeSafeRefund = (rule: SplitRule) => proofKind(rule) === "made_safe" && paysRefund(rule);

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export type ProofSplit = {
  /** Every recall in the pull, and how many the classifier counts as photo-refund. */
  recalls: number;
  photoRefund: number;
  /** Photo-refund recalls with no stored rule (should be none). */
  missingRules: string[];
  /** Of the photo-refund recalls: a photo of the product made safe. */
  madeSafe: number;
  /** The headline: made safe, and a refund in money. Its share of every recall, and by year. */
  madeSafeRefund: { count: number; share: number; byYear: Record<string, number> };
  /** Made safe, but the owner gets store credit or a gift card for it. */
  madeSafeCredit: { count: number; numbers: string[] };
  /** A photo for another reason: of the product itself, or of a label, serial or date code. */
  otherPhoto: { count: number; product: number; identifier: { count: number; numbers: string[] } };
  /** No photo step in the rule. */
  noPhoto: { count: number; numbers: string[] };
};

/** Split the photo-refund recalls by what their rule asks the photo to show. */
export function proofSplit(recalls: SplitRecall[], rules: Record<string, SplitRule>): ProofSplit {
  const pr = recalls.filter((r) => r.photoRefund);
  const missingRules = pr.filter((r) => !rules[r.number]).map((r) => r.number);
  const ruled = pr.filter((r) => rules[r.number]).map((r) => ({ r, rule: rules[r.number], kind: proofKind(rules[r.number]) }));
  const of = (k: ProofKind) => ruled.filter((x) => x.kind === k);
  const made = of("made_safe");
  const refund = made.filter((x) => paysRefund(x.rule));
  const credit = made.filter((x) => !paysRefund(x.rule));
  const years = [...new Set(recalls.map((r) => r.date.slice(0, 4)))].sort();
  return {
    recalls: recalls.length,
    photoRefund: pr.length,
    missingRules,
    madeSafe: made.length,
    madeSafeRefund: {
      count: refund.length,
      share: pct(refund.length, recalls.length),
      byYear: Object.fromEntries(years.map((y) => [y, refund.filter((x) => x.r.date.startsWith(y)).length])),
    },
    madeSafeCredit: { count: credit.length, numbers: credit.map((x) => x.r.number) },
    otherPhoto: {
      count: of("product").length + of("identifier").length,
      product: of("product").length,
      identifier: { count: of("identifier").length, numbers: of("identifier").map((x) => x.r.number) },
    },
    noPhoto: { count: of("none").length, numbers: of("none").map((x) => x.r.number) },
  };
}
