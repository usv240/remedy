/**
 * The figures /evidence shows, each read from the file that holds it: the CPSC counts (content/recalls/stats.json), the
 * extraction benchmark (content/recalls/benchmark/results.json), the extraction's own cost
 * (content/recalls/proof-rules.json) and the recorded photo checks (content/public/verify-runs.json). Server only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cacheLife } from "next/cache";
import { getPreset, runPreset } from "@/app/api/try/_lib/presets";
import { LIMITS } from "@/lib/verify/checks";
import stats from "../../../content/recalls/stats.json";
import runsFile from "../../../content/public/verify-runs.json";
import bench from "../../../content/recalls/benchmark/results.json";
import { measured } from "@/lib/payout-timing";

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

/** content/public/measured.json, with the payout's range and run count counted from both records (src/lib/payout-timing.ts). */
export const MEASURED = measured();

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
    // Confirmed the way C2 counts it: done, and at least as sure as the made-safe pass mark.
    return { score: r.product.match_score, cut: Boolean(cut?.done && cut.confidence >= LIMITS.actionConfidence), ms: f.vision.ms, recordedAt: f.recorded_at, noticed: r.photo_source?.kind === "digital_image" ? r.photo_source.reason : null };
  } catch {
    return null;
  }
}

export type ReplayCheck = { id: string; name: string; status: string; score: number | null; reason: string; technical: string };
export type CpscReplay = { decision: string; decidedBy: string; checks: ReplayCheck[]; summaryPlain: string; summaryTechnical: string; visionMs: number; recordedAt: string; settings: string };

/**
 * The 26125 example as the site shows it everywhere (home, /try, /evidence): the owner flow's one recorded Claude answer,
 * read with the recall's official pictures, replayed through the real verifier with no model call. The official-picture
 * match is off for this run so the AI check can be seen; with it on (the default), the photo is answered in code.
 * Null when the recording or the verifier cannot run, so callers fall back to their own recorded row.
 */
export async function cpscExampleReplay(): Promise<CpscReplay | null> {
  "use cache";
  cacheLife("days");
  try {
    const p = getPreset("cpsc-example");
    if (!p?.technical) return null;
    const run = await runPreset(p, { technical: true });
    const ex = cpscExampleRun();
    if (!run.replay.used || !ex) return null;
    const r = run.result;
    if (!r.decision || !r.decided_by || !r.summary) return null;
    return {
      decision: r.decision,
      decidedBy: r.decided_by,
      checks: r.checks.map((c) => ({ id: c.id, name: c.name, status: c.status, score: c.score, reason: c.reason_plain, technical: c.reason_technical })),
      summaryPlain: r.summary.plain,
      summaryTechnical: r.summary.technical,
      visionMs: ex.ms,
      recordedAt: ex.recordedAt,
      settings: "Official-picture match turned off for this run, so the AI check can be seen; reviewers off.",
    };
  } catch {
    return null;
  }
}

/**
 * The 26125 example the way a claim answers it, with every check at its default: the free picture match recognizes
 * the CPSC's own published photo and asks for the owner's own, with no model call. Run through the real verifier at
 * build time. Null when the verifier cannot run here.
 */
export async function cpscExampleDefault(): Promise<{ decision: string; decidedBy: string; totalMs: number; checks: ReplayCheck[] } | null> {
  "use cache";
  cacheLife("days");
  try {
    const p = getPreset("cpsc-example");
    if (!p) return null;
    const run = await runPreset(p);
    const r = run.result;
    if (run.replay.used || run.live_ai || !r.decision || !r.decided_by) return null;
    return {
      decision: r.decision,
      decidedBy: r.decided_by,
      totalMs: r.timings?.total_ms ?? 0,
      checks: r.checks.map((c) => ({ id: c.id, name: c.name, status: c.status, score: c.score, reason: c.reason_plain, technical: c.reason_technical })),
    };
  } catch {
    return null;
  }
}

/** Cases with no AI call where the decision fits what the case expects; counted in errors.ts, which scripts/facts.ts reads too. */
export { freeCaught } from "./errors";
