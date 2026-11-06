/**
 * The figures /judges shows, each read from the file that holds it: the CPSC counts (content/recalls/stats.json), the
 * extraction benchmark (content/recalls/benchmark/results.json), the extraction's own cost
 * (content/recalls/proof-rules.json) and the recorded photo checks (content/public/verify-runs.json). Server only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import stats from "../../../content/recalls/stats.json";
import runsFile from "../../../content/public/verify-runs.json";
import bench from "../../../content/recalls/benchmark/results.json";
import measuredFile from "../../../content/public/measured.json";

export const S = stats.current;

/** proof-rules.json is 660 KB, so only its header is read, once. */
let rulesMeta: { model: string; extractedAt: string; counts: { recalls: number; photoRefund: number }; usage: { calls: number; inputTokens: number; outputTokens: number; usd: number; pricing: string }; minutes: number } | null = null;
export function extraction() {
  if (!rulesMeta) {
    const f = JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "proof-rules.json"), "utf8"));
    rulesMeta = { model: f.model, extractedAt: f.extractedAt, counts: f.counts, usage: f.usage, minutes: f.minutes };
  }
  return rulesMeta;
}

export type BenchVariant = "baseline" | "claude" | "claude_selfcheck";
export const VARIANTS: { id: BenchVariant; name: string; about: string }[] = [
  { id: "baseline", name: "Keyword rules", about: "Regular expressions over the remedy text: what an engineer would write first. No AI." },
  { id: "claude", name: "Claude Opus 5.5", about: "Structured output at medium effort, one pass." },
  { id: "claude_selfcheck", name: "Claude with a self-check", about: "The same, then a second pass that checks the draft against the remedy text and a deterministic lint. This is what Remedy uses." },
];
export const FIELD_NAMES: Record<string, string> = {
  photo_required: "Photo required",
  actions: "What to do",
  marker_text: "Words to write",
  must_show: "What the photo shows",
  remedy: "What you get",
  refund_amount: "Refund amount",
  contact_channel: "How it is sent",
};
export const BENCH = bench as unknown as {
  status: string;
  scoredAt: string;
  scoring: string;
  sample: { items: number; photoRefund: number; nonPhoto: number };
  fields: string[];
  variants: Record<BenchVariant, { n: number; allFieldsCorrect: { count: number; rate: number }; fields: Record<string, number>; actionsPRF: { precision: number; recall: number; f1: number }; usdForSample: number; byKind: Record<string, { n: number; allFieldsCorrect: { count: number; rate: number } }> }>;
};
export const pct = (r: number, digits = 1) => `${(r * 100).toFixed(digits).replace(/\.0$/, "")}%`;

export type RunRow = {
  id: string;
  title: string;
  about: string;
  recall: string;
  expect: string;
  needs_vision: boolean;
  settings?: string;
  usd: number;
  result: { decision: string; decided_by: string; summary: { plain: string; technical: string }; timings: { total_ms: number; vision_ms: number }; checks: Record<string, { name: string; status: string; score: number | null; reason: string; technical: string }> };
};
export const RUNS = runsFile as unknown as { recordedAt: string; totalUsd: number; runs: RunRow[] };

export const MEASURED = measuredFile as { note: string; measuredAt: string; environment: string; items: { id: string; figure: string; what: string; source: string }[] };

/**
 * The owner flow's recorded run of the CPSC's 26125 example with the official-image match off: what Claude read in the
 * photo. Null when the file is not there.
 */
export function cpscExampleRun(): { score: number; cut: boolean; ms: number; recordedAt: string; noticed: string | null } | null {
  try {
    const f = JSON.parse(readFileSync(path.join(process.cwd(), "content", "presets", "recorded", "cpsc-example.technical.json"), "utf8"));
    const r = f.vision?.report;
    if (!r) return null;
    const cut = (r.actions ?? []).find((a: { action: string }) => a.action === "cut_cord");
    return { score: r.product.match_score, cut: Boolean(cut?.done), ms: f.vision.ms, recordedAt: f.recorded_at, noticed: r.photo_source?.kind === "digital_image" ? r.photo_source.reason : null };
  } catch {
    return null;
  }
}

/** Cases with no AI call where the decision fits what the case expects (a copy or reused photo is never verified). */
export function freeCaught() {
  const free = RUNS.runs.filter((r) => !r.needs_vision);
  return { caught: free.filter((r) => r.result.decision !== "verified").length, total: free.length };
}
