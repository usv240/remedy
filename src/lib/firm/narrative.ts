/**
 * The report's short narrative paragraph. Claude Haiku 5.5 (effort low) writes it from the numbers SQL counted; it
 * never counts anything itself. Every figure in its paragraph must be one of the report's own, or the plain template
 * is used instead. Written once per month and stored in the report table; it is written again only when a person asks
 * and the numbers have changed since. Server only.
 */
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { aiAvailable, claude } from "@/lib/ai/claude";
import { logUsage, overBudget } from "@/lib/ai/usage";
import { log } from "@/lib/log";
import { recallLabel } from "@/lib/recall/label";
import { dayName } from "./dates";
import type { Firm, FirmRecall } from "./firm";
import { strayFigures, templateNarrative, type ReportNumbers } from "./report";
import { saveNarrative, storedNarrative } from "./report-data";

export const NARRATIVE_MODEL = "claude-haiku-5-5";

export type Narrative = {
  text: string;
  source: "claude" | "template";
  model: string | null;
  /** Stored earlier for this month. */
  cached: boolean;
  /** The numbers changed after the stored paragraph was written. */
  stale: boolean;
  writtenAt: string | null;
  note: string | null;
};

/** The numbers that matter for the paragraph, so the time it was generated does not make it look stale. */
export function fingerprint(n: Partial<ReportNumbers>) {
  const { generatedAt: _skip, ...rest } = n;
  void _skip;
  return createHash("sha256").update(stable(rest)).digest("hex").slice(0, 16);
}

/** JSON with keys sorted at every level, so the same numbers always give the same text. */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

const SYSTEM = [
  "You write the summary paragraph of a recall's monthly progress report, which the recalling firm files with the US Consumer Product Safety Commission.",
  "Use only the figures given, written exactly as given. Do not add any other number, date, cause, forecast or comparison.",
  "Write 3 to 5 plain sentences, about a 6th grade reading level, in a calm and positive tone. Never blame anyone.",
  "No lists, headings, quotes or em dashes. US spelling. Return only the paragraph.",
].join(" ");

/** What Claude sees: labelled figures, already formatted. */
export function promptFigures(n: ReportNumbers) {
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  return {
    firm: n.firmName,
    product: n.product,
    recall: recallLabel(n.recallNumber),
    report_number: n.period.index,
    period: `${dayName(n.period.start)} to ${dayName(n.period.through)}${n.period.inProgress ? " (the month is still running)" : ""}`,
    claims_received: n.claimsReceived,
    claims_verified_made_safe: n.claimsVerified,
    units_corrected_this_period: n.correctionsThisPeriod,
    units_corrected_since_announcement: n.correctionsCumulative,
    units_affected: n.unitsAffected,
    completion_percent: n.completionPercent === null ? null : n.completionPercent.toFixed(2),
    refunds_paid: n.refundsPaidCount,
    refunds_paid_total: usd(n.refundsPaidCents),
    replacements: n.replacementsCount,
    payouts_waiting_to_be_accepted: n.unclaimedCount,
    claims_with_a_reviewer: n.claimsInReview,
    new_photos_asked: n.retakesAsked,
  };
}

/** Problems that send the paragraph back to the template. */
export function narrativeProblems(text: string, n: ReportNumbers): string[] {
  const out: string[] = [];
  const stray = strayFigures(text, n);
  if (stray.length) out.push(`figures not in the report: ${stray.join(", ")}`);
  if (/—/.test(text)) out.push("an em dash");
  if (/\b(fraud|fake|scam)/i.test(text)) out.push("unkind words");
  if (text.length < 40 || text.length > 1400) out.push("length");
  if (/^\s*[-*#]/m.test(text)) out.push("a list or heading");
  return out;
}

async function writeWithClaude(n: ReportNumbers): Promise<{ text: string; model: string } | { error: string }> {
  const c = claude();
  if (!c) return { error: "Claude is not connected on this server." };
  try {
    const res = await c.messages.create({
      model: NARRATIVE_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `<report_figures>\n${JSON.stringify(promptFigures(n), null, 2)}\n</report_figures>\nWrite the summary paragraph.` }],
    });
    await logUsage({ route: "firm.report.narrative", model: res.model, effort: "low", usage: res.usage });
    if (res.stop_reason === "refusal") return { error: "Claude declined this request." };
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return { text, model: res.model };
  } catch (e) {
    return { error: e instanceof Anthropic.APIError ? `Claude answered ${e.status}.` : "Claude could not be reached." };
  }
}

/**
 * The paragraph for this month. `write` asks Claude when nothing fresh is stored; otherwise the stored paragraph (or
 * the template) is returned with no model call.
 */
export async function narrativeFor(firm: Firm, recall: FirmRecall, n: ReportNumbers, opts: { write?: boolean } = {}): Promise<Narrative> {
  const stored = await storedNarrative(firm.id, recall.number, n.period.month);
  const fresh = Boolean(stored?.narrative) && fingerprint(stored!.numbers as Partial<ReportNumbers>) === fingerprint(n);
  const fromStore = (stale: boolean, note: string | null = null): Narrative => ({
    text: stored!.narrative!,
    source: stored!.narrative_model ? "claude" : "template",
    model: stored!.narrative_model,
    cached: true,
    stale,
    writtenAt: new Date(stored!.updated_at).toISOString(),
    note,
  });
  const template = (note: string | null): Narrative => ({ text: templateNarrative(n), source: "template", model: null, cached: false, stale: false, writtenAt: null, note });

  if (fresh) return fromStore(false);
  if (!opts.write) return stored?.narrative ? fromStore(true) : template(null);

  if (!aiAvailable()) return template("Claude is not connected on this server, so the plain template is used.");
  const budget = await overBudget();
  if (budget.over) return template("Today's AI budget is used up, so the plain template is used.");

  const r = await writeWithClaude(n);
  if ("error" in r) return template(`${r.error} The plain template is used.`);
  const problems = narrativeProblems(r.text, n);
  if (problems.length) {
    log.warn("firm narrative set aside", { model: r.model, problems });
    return template(`Claude's paragraph was set aside (${problems.join("; ")}), so the plain template is used.`);
  }
  await saveNarrative(firm.id, recall.number, n.period.month, n, r.text, r.model);
  return { text: r.text, source: "claude", model: r.model, cached: false, stale: false, writtenAt: new Date().toISOString(), note: null };
}
