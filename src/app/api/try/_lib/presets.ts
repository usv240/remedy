/**
 * Ready-made examples for /try (content/presets/index.json). Running one runs the real verifier on the real photo.
 * Checks that need no model (the official-image match, the quality precheck) run live every time, for free. Checks that
 * need Claude replay the one recorded live answer in content/presets/recorded/, and every check around that answer runs
 * again in code. Presets never create a claim and never pay. Server only.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { aiAvailable } from "@/lib/ai/claude";
import { costUsd, overBudget } from "@/lib/ai/usage";
import { SANDBOX_LABEL } from "@/lib/payments/deps";
import { CHECK_IDS, verifyPhoto, type VerifyDeps, type VerifyResult } from "@/lib/verify";
import { runReviewers, type ReviewRun } from "@/lib/verify/reviewers";
import { runVision, type VisionRun } from "@/lib/verify/vision";
import { getRecall, productName, ruleFor, verifyRecallFor } from "../../claims/_lib/recall";
import { DEFAULT_TERMS, firmTerms } from "../../claims/_lib/terms";
import type { ClaimView } from "../../claims/_lib/types";

const ROOT = process.cwd();
const PRESETS_DIR = path.join(ROOT, "content", "presets");
const FIXTURES = path.join(ROOT, "content", "verify", "fixtures");

export type RunOptions = { officialHashCheck?: boolean; reviewers?: boolean };
export type Preset = {
  id: string;
  title: string;
  summary: string;
  recall: string;
  /** Relative to content/verify/fixtures. */
  photo: string;
  photo_alt: string;
  photo_credit: string;
  expected: { decision?: string; decided_by?: string; checks?: Record<string, string>; plain: string };
  technical?: { note: string; options: RunOptions; recorded: string };
  recorded?: string;
  /** One of the team's own photos, from content/verify/fixtures/user/expected.json. */
  user?: boolean;
};

export type Recorded = {
  recorded_at: string;
  preset: string;
  recall: string;
  options: RunOptions;
  vision: VisionRun | null;
  reviews: ReviewRun | null;
  cost_usd: number;
  decision: string;
  decided_by: string;
};

type IndexFile = { note: string; presets: Preset[] };
let indexCache: IndexFile | null = null;
const readIndex = () => (indexCache ??= JSON.parse(readFileSync(path.join(PRESETS_DIR, "index.json"), "utf8")) as IndexFile);

/** "P1-power-bank-marked.jpg" reads "Power bank marked". */
const titleOf = (file: string) => {
  const words = path.basename(file, path.extname(file)).replace(/^[A-Z]\d+[-_]?/, "").replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : file;
};

/** The team's own photos, when content/verify/fixtures/user/expected.json lists some that exist. */
export function userPresets(): Preset[] {
  const file = path.join(FIXTURES, "user", "expected.json");
  if (!existsSync(file)) return [];
  let map: Record<string, { recall: string; decision?: string; checks?: Record<string, string> }>;
  try {
    map = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  return Object.entries(map)
    .filter(([name, e]) => e?.recall && existsSync(path.join(FIXTURES, "user", name)))
    .map(([name, e]) => {
      const id = `user-${path.basename(name, path.extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      return {
        id,
        title: titleOf(name),
        summary: `One of the team's own photos, checked against recall ${e.recall}.`,
        recall: e.recall,
        photo: `user/${name}`,
        photo_alt: `${titleOf(name)}, photographed by the Remedy team.`,
        photo_credit: "Photo by the Remedy team, of a product the team owns.",
        expected: { decision: e.decision, checks: e.checks, plain: e.decision === "verified" ? "Verified, so a sandbox payout can be sent." : e.decision === "retake" ? "A friendly retake, with what to change." : "A person at the firm takes a look." },
        recorded: existsSync(path.join(PRESETS_DIR, "recorded", `${id}.json`)) ? `${id}.json` : undefined,
        user: true,
      } satisfies Preset;
    });
}

export function listPresets(): { note: string; presets: Preset[]; user: Preset[] } {
  const idx = readIndex();
  return { note: idx.note, presets: idx.presets, user: userPresets() };
}

export function getPreset(id: string): Preset | null {
  if (!/^[a-z0-9-]{2,80}$/.test(id)) return null;
  const all = listPresets();
  return [...all.presets, ...all.user].find((p) => p.id === id) ?? null;
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
export function presetPhoto(p: Preset): { bytes: Buffer; mime: string; name: string } {
  const file = path.join(FIXTURES, p.photo);
  return { bytes: readFileSync(file), mime: MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", name: `remedy-${p.id}${path.extname(file).toLowerCase()}` };
}

export function readRecorded(name: string | undefined): Recorded | null {
  if (!name) return null;
  const file = path.join(PRESETS_DIR, "recorded", name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Recorded;
  } catch {
    return null;
  }
}

/** The verifier's answer in the claims API's shape, so the Try page and the claim page share one result view. */
export function viewFromResult(r: VerifyResult, p: Preset, firm: { name: string; reviewHours: number }): ClaimView {
  const recall = getRecall(p.recall);
  return {
    id: `preset-${p.id}`,
    recall: { number: p.recall, title: recall?.title ?? `Recall ${p.recall}`, product: recall ? productName(recall) : `Recall ${p.recall}` },
    status: r.decision,
    decision: r.decision,
    decided_by: r.decided_by,
    channel: "preset",
    created_at: new Date().toISOString(),
    decided_at: new Date().toISOString(),
    checks: CHECK_IDS.map((id) => {
      const c = r.checks[id];
      return { id, name: c.name, status: c.status, pass: c.pass, score: typeof c.score === "number" ? c.score : null, reason_plain: c.reason_plain, reason_technical: c.reason_technical };
    }),
    guidance: r.guidance ?? null,
    summary: r.summary,
    amount: r.amount ? { value: r.amount.value, currency: r.amount.currency, source: "demo" } : null,
    quality: { ok: r.quality.ok, issues: r.quality.issues },
    timings: { ...r.timings },
    model: r.model,
    review: r.review,
    link: null,
    payment: null,
    firm: { name: firm.name, sample: true, review_hours: firm.reviewHours, refund_source: "demo" },
    photo_url: `/api/try/presets/${p.id}/photo`,
    receipt_url: "",
    sandbox_label: SANDBOX_LABEL,
  };
}

export type PresetRun = {
  preset: Preset;
  result: ClaimView;
  /** Whether a recorded Claude answer was replayed, and when it was recorded. */
  replay: { used: boolean; recorded_at: string | null; model: string | null; cost_usd_when_recorded: number | null };
  live_ai: boolean;
};

/**
 * Run a preset. `technical` runs its second configuration (the CPSC example with the official-image match off).
 * With a recording, the model's answer is replayed; without one, a user photo may run live within the AI budget.
 */
export async function runPreset(p: Preset, opts: { technical?: boolean } = {}): Promise<PresetRun> {
  const recall = getRecall(p.recall);
  if (!recall) throw new Error(`Preset ${p.id} names recall ${p.recall}, which is not in recalls.json.`);
  const options = opts.technical && p.technical ? p.technical.options : {};
  const recorded = readRecorded(opts.technical && p.technical ? p.technical.recorded : p.recorded);
  const terms = await firmTerms(p.recall).catch(() => DEFAULT_TERMS);
  const { bytes } = presetPhoto(p);

  let deps: VerifyDeps = { aiAvailable: () => false };
  let liveAi = false;
  if (recorded?.vision) {
    deps = { aiAvailable: () => false, vision: async () => ({ ...recorded.vision!, replayed: true }), reviewers: recorded.reviews ? async () => recorded.reviews! : undefined };
  } else if (p.user && aiAvailable() && !(await overBudget().catch(() => ({ over: true }))).over) {
    // A user photo with no recording runs live; the verification cache answers repeats for free.
    deps = {};
    liveAi = true;
  }
  const r = await verifyPhoto(
    {
      photo: bytes,
      recall: verifyRecallFor(recall),
      proofRule: ruleFor(recall).rule,
      claimContext: { firmAmount: { value: (terms.refundCents / 100).toFixed(2), currency: "USD" }, autoCap: { value: (terms.autoCapCents / 100).toFixed(2), currency: "USD" }, firmName: terms.firmName },
      options,
    },
    deps,
  );
  return {
    preset: p,
    result: viewFromResult(r, p, { name: terms.firmName, reviewHours: terms.reviewHours }),
    replay: { used: Boolean(recorded?.vision), recorded_at: recorded?.recorded_at ?? null, model: recorded?.vision?.model ?? null, cost_usd_when_recorded: recorded?.cost_usd ?? null },
    live_ai: liveAi,
  };
}

/**
 * Record a preset's one live Claude answer (scripts only, never from a route): runs the verifier live, keeps the
 * vision report and any reviews, and writes content/presets/recorded/<name>. Returns what it cost.
 */
export async function recordPreset(p: Preset, opts: { technical?: boolean } = {}): Promise<Recorded> {
  const recall = getRecall(p.recall);
  if (!recall) throw new Error(`No recall ${p.recall}`);
  const name = opts.technical ? p.technical?.recorded : (p.recorded ?? `${p.id}.json`);
  if (!name) throw new Error(`Preset ${p.id} has nothing to record.`);
  const options = opts.technical && p.technical ? p.technical.options : {};
  let vision: VisionRun | null = null;
  let reviews: ReviewRun | null = null;
  const r = await verifyPhoto(
    { photo: presetPhoto(p).bytes, recall: verifyRecallFor(recall), proofRule: ruleFor(recall).rule, claimContext: { firmAmount: { value: "20.00", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } }, options },
    {
      vision: async (a) => (vision = await runVision(a)),
      reviewers: async (a) => (reviews = await runReviewers(a)),
    },
  );
  const v = vision as VisionRun | null;
  const rv = reviews as ReviewRun | null;
  const cost = (v ? costUsd(v.model, v.usage) : 0) + (rv ? rv.reviews.reduce((s, x) => s + costUsd(x.model, x.usage), 0) : 0);
  const out: Recorded = { recorded_at: new Date().toISOString(), preset: p.id, recall: p.recall, options, vision: v, reviews: rv, cost_usd: Math.round(cost * 10000) / 10000, decision: r.decision, decided_by: r.decided_by };
  await mkdir(path.join(PRESETS_DIR, "recorded"), { recursive: true });
  await writeFile(path.join(PRESETS_DIR, "recorded", name), JSON.stringify(out, null, 2) + "\n");
  return out;
}
