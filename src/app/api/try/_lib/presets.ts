/**
 * Ready-made examples for /try (content/presets/index.json). Running one runs the real verifier on the real photo.
 * Checks that need no model (the official-image match, the quality precheck) run live every time, for free. Checks that
 * need Claude replay the one recorded live answer in content/presets/recorded/, and every check around that answer runs
 * again in code. Running a preset never creates a claim and never pays (the one-click sandbox payout is
 * src/app/api/try/_lib/sandbox-payout.ts). Server only.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { aiAvailable } from "@/lib/ai/claude";
import { costUsd, overBudget } from "@/lib/ai/usage";
import { SANDBOX_LABEL } from "@/lib/payments/deps";
import { CHECK_IDS, verifyPhoto, type VerifyDeps, type VerifyResult } from "@/lib/verify";
import { engineVersion } from "@/lib/verify/cache";
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
  /** Runs against a fictional sample recall (Brightline Home's BH-2026-01); the page's note says so once. */
  sample?: boolean;
  /** "made-safe": a photo of a product made safe, shown first on /try with the photos of the same product before. */
  group?: "made-safe";
};

export type Recorded = {
  recorded_at: string;
  /** The verification engine the answer was recorded on (src/lib/verify/cache.ts); a different one makes it stale. */
  engine?: string;
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

/**
 * A photo of the sample charger shown with its recorded results instead of a Run button: the measured sweep at the
 * claim path's own setting (content/verify/sweep-sample.json), against the known answer in
 * content/verify/fixtures/cases.json. Nothing runs when the page opens.
 */
export type RecordedSample = {
  id: string;
  title: string;
  summary: string;
  thumb: string;
  photo_alt: string;
  photo_credit: string;
  expected: { decision: string; plain: string };
  /** matching: the runs whose decision is the expected one. */
  recorded: { runs: number; matching: number; decision: string; decided_by: string; checks: Record<string, string>; reason_technical: string; model: string; effort: string | null; ran_at: string };
};

type SweepSample = {
  ranAt: string;
  configs: { id: string; model: string; effort?: string }[];
  cases: { config: string; case: string; decision: string; decided_by: string; ok: boolean; C1_status?: string; C2: string; C3: string; C2_reason?: string }[];
};

const SAMPLE_PHOTOS: { id: string; title: string; summary: string; thumb: string; photo_alt: string; expected: { decision: string; plain: string } }[] = [
  {
    id: "sample-charger-opened-cord-attached",
    title: "The same charger, opened, cord still attached",
    summary: "The charger's case opened up, with its cord still running into it, sent for sample recall BH-2026-01, which asks for the cord to be cut.",
    thumb: "/samples/charger/opened-cord-attached-sm.webp",
    photo_alt: "A hand holding the opened charger case, its black cord still attached where it enters the case.",
    expected: { decision: "retake", plain: "Not made safe yet: the cord is still attached, so the owner is asked to cut it first, and nothing is paid." },
  },
  {
    id: "sample-charger-opened-case",
    title: "The same charger, taken apart",
    summary: "The charger taken apart on a table, its cord still wired to the board, sent for sample recall BH-2026-01.",
    thumb: "/samples/charger/opened-case-sm.webp",
    photo_alt: "The charger taken apart on a white surface, its circuit board and yellow insulating sheets out, the cord still wired to the board.",
    expected: { decision: "retake", plain: "Taken apart is not the remedy: the cord is still wired in, so the owner is asked to cut the cord, and nothing is paid." },
  },
];

/** The two opened-charger photos with their recorded results, or none when the sweep file is not there. */
export function recordedSamples(): RecordedSample[] {
  const file = path.join(ROOT, "content", "verify", "sweep-sample.json");
  if (!existsSync(file)) return [];
  const sweep = JSON.parse(readFileSync(file, "utf8")) as SweepSample;
  const config = sweep.configs[0];
  // The page's own note says the sample firm and its recall are fictional, once for the page.
  const credit = "Photo: Dmitry G, Wikimedia Commons, public domain.";
  return SAMPLE_PHOTOS.flatMap((s) => {
    const rows = sweep.cases.filter((c) => c.case === s.id && c.config === config?.id);
    if (!rows.length) return [];
    const last = rows[rows.length - 1];
    const same = rows.filter((r) => r.decision === s.expected.decision);
    return [
      {
        ...s,
        photo_credit: credit,
        recorded: {
          runs: rows.length,
          matching: same.length,
          decision: last.decision,
          decided_by: last.decided_by,
          checks: { C1: last.C1_status ?? "", C2: last.C2, C3: last.C3 },
          reason_technical: last.C2_reason ?? "",
          model: config.model,
          effort: config.effort ?? null,
          ran_at: sweep.ranAt,
        },
      },
    ];
  });
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
  replay: { used: boolean; recorded_at: string | null; model: string | null; cost_usd_when_recorded: number | null; ms_when_recorded: { vision: number; reviewers: number } | null };
  live_ai: boolean;
  /** A "Run it live" request: whether the model ran just now, what it cost, or why the recorded run is shown instead. */
  live?: { ran: boolean; note: string | null; usd: number | null; model: string | null } | null;
};

/** The one example a visitor may run live against the model: Brightline's sample charger with its cord cut. */
export const LIVE_PRESET = "sample-charger-cut";

/** Why a live run was not made, in plain words; the recorded run is shown instead. */
export type LiveGate = { ok: true } | { ok: false; why: "no_key" | "budget" | "used"; plain: string };

/**
 * Whether a live run may go ahead: a Claude key, today's AI budget (AI_DAILY_USD, the same budget every claim spends
 * from) not spent, and this visitor's one live run of the day not used yet (`allowVisitor`).
 */
export async function liveGate(allowVisitor: () => Promise<boolean>, deps: { ai?: () => boolean; budget?: () => Promise<{ over: boolean }> } = {}): Promise<LiveGate> {
  if (!(deps.ai ?? aiAvailable)()) return { ok: false, why: "no_key", plain: "This server has no Claude key, so this is the recorded run." };
  if ((await (deps.budget ?? overBudget)().catch(() => ({ over: true }))).over) return { ok: false, why: "budget", plain: "Today's AI budget is spent, so this is the recorded run. Live runs open again tomorrow (UTC)." };
  if (!(await allowVisitor())) return { ok: false, why: "used", plain: "You have used today's live run, so this is the recorded run. Every visitor gets one live run a day." };
  return { ok: true };
}

/**
 * Run a preset. `technical` runs its second configuration (the CPSC example with the official-image match off).
 * With a recording, the model's answer is replayed; without one, a user photo may run live within the AI budget.
 * `live` (only for LIVE_PRESET) calls the model for real when `live` allows it, with the verification cache off so the
 * answer is new; otherwise it shows the recorded run with the reason.
 */
export async function runPreset(p: Preset, opts: { technical?: boolean; live?: LiveGate; deps?: VerifyDeps } = {}): Promise<PresetRun> {
  const recall = getRecall(p.recall);
  if (!recall) throw new Error(`Preset ${p.id} names recall ${p.recall}, which is not in recalls.json.`);
  const options = opts.technical && p.technical ? p.technical.options : {};
  const recorded = readRecorded(opts.technical && p.technical ? p.technical.recorded : p.recorded);
  const terms = await firmTerms(p.recall).catch(() => DEFAULT_TERMS);
  const { bytes } = presetPhoto(p);

  let deps: VerifyDeps = { aiAvailable: () => false };
  let liveAi = false;
  let liveNote: string | null = null;
  const live = p.id === LIVE_PRESET && !opts.technical ? opts.live : undefined;
  if (live?.ok) {
    deps = opts.deps ?? {};
    liveAi = true;
  } else if (recorded?.vision) {
    if (live && !live.ok) liveNote = live.plain;
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
      options: liveAi && live ? { ...options, cache: false } : options,
    },
    deps,
  );
  const ranLive = liveAi && r.cache.vision === "live";
  const usd = ranLive ? (r.usage.vision ? costUsd(r.model ?? "claude-opus-5-5", r.usage.vision) : 0) + r.usage.reviewers.reduce((s, u) => s + (u ? costUsd(r.model ?? "claude-opus-5-5", u) : 0), 0) : null;
  return {
    preset: p,
    result: viewFromResult(r, p, { name: terms.firmName, reviewHours: terms.reviewHours }),
    replay: { used: !liveAi && Boolean(recorded?.vision), recorded_at: recorded?.recorded_at ?? null, model: recorded?.vision?.model ?? null, cost_usd_when_recorded: recorded?.cost_usd ?? null, ms_when_recorded: recorded?.vision ? { vision: recorded.vision.ms, reviewers: recorded.reviews?.ms ?? 0 } : null },
    live_ai: liveAi,
    live: live ? { ran: ranLive, note: ranLive ? null : (liveNote ?? (liveAi ? "The model could not be reached just now, so a person at the firm would look at this claim." : null)), usd: usd === null ? null : Math.round(usd * 10000) / 10000, model: ranLive ? r.model : null } : null,
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
  const out: Recorded = { recorded_at: new Date().toISOString(), engine: engineVersion(), preset: p.id, recall: p.recall, options, vision: v, reviews: rv, cost_usd: Math.round(cost * 10000) / 10000, decision: r.decision, decided_by: r.decided_by };
  await mkdir(path.join(PRESETS_DIR, "recorded"), { recursive: true });
  await writeFile(path.join(PRESETS_DIR, "recorded", name), JSON.stringify(out, null, 2) + "\n");
  return out;
}
