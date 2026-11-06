/**
 * A proof rule in a few words, for result rows, cards and the API's search hits. Client-safe: no file reads.
 * The rule itself comes from content/recalls/proof-rules.json (Claude Opus 5.5 with a self-check pass).
 */

export type RuleSummary = {
  photo_required: boolean;
  actions: string[];
  marker_text: string | null;
  must_show: string[];
  remedy: string;
  refund_amount: number | null;
  refund_amount_text: string | null;
  steps: string[];
};

const ACTION: Record<string, string> = {
  cut_cord: "Cut the cord",
  cut_in_half: "Cut in half",
  remove_part: "Remove a part",
  puncture: "Puncture it",
  disassemble: "Take it apart",
  other: "Make it unusable",
};

const SHOW: Record<string, string> = {
  label: "Photo of label",
  model_number: "Show model number",
  serial_or_lot: "Show lot or serial",
  date_code: "Show date code",
};

const REMEDY: Record<string, string> = {
  full_refund: "Full refund",
  partial_refund: "Partial refund",
  replacement: "Replacement",
  repair: "Repair",
  refund_or_replacement: "Refund or replacement",
  other: "Other remedy",
};

/** The words to write, as the owner should write them: "recalled" becomes RECALLED. */
export const markerWord = (r: Pick<RuleSummary, "marker_text">) => (r.marker_text?.trim() || "RECALLED").toUpperCase();

/** Plain label for one action, for example "Write RECALLED" or "Cut the cord". */
export function actionLabel(action: string, r: Pick<RuleSummary, "marker_text">): string {
  if (action === "write_recalled") return `Write ${markerWord(r)}`;
  return ACTION[action] ?? "Make it unusable";
}

export const remedyLabel = (remedy: string) => REMEDY[remedy] ?? "Other remedy";
export const showLabel = (s: string) => SHOW[s] ?? null;

/** Up to four chips, in the order the owner meets them: what to do, what to show, what they get. */
export function ruleChips(r: RuleSummary | null | undefined, max = 4): string[] {
  if (!r) return [];
  const out: string[] = [];
  for (const a of r.actions) out.push(actionLabel(a, r));
  for (const s of r.must_show) {
    const label = SHOW[s];
    if (label) out.push(label);
  }
  if (r.photo_required && r.actions.length === 0 && !out.length) out.push("Photo required");
  const money = r.refund_amount ? `$${Number.isInteger(r.refund_amount) ? r.refund_amount : r.refund_amount.toFixed(2)} refund` : remedyLabel(r.remedy);
  const unique = [...new Set(out)];
  return [...unique.slice(0, max - 1), money];
}

/** Field confidence as a whole percent, for the "how sure" column. */
export const percent = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${Math.round(n * 100)}%` : "-");
