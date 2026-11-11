/**
 * Verification sweep: the same known-answer fixture cases through four model and effort settings,
 * scored on whether each decision matches its expected answer, with cost and time per case.
 *
 *   npx tsx --env-file=.env.local scripts/verify/sweep.ts                 estimate only, free (count_tokens)
 *   npx tsx --env-file=.env.local scripts/verify/sweep.ts --run --yes     spends real money; get approval first
 *   options: --config opus-low,haiku-medium   --trials 3   --max-usd 3   --fresh (ignore AI_CACHE_DIR replays)
 *            --set sample: only the fixture cases marked sweep: "sample" (photos for a sample recall), written to
 *            content/verify/sweep-sample.json, so the four-setting comparison keeps the identical cases in every cell;
 *            add --case id,id to run only those, keeping every other row already in the set's file
 *            --cap-usd 4.75 --since <ISO time>: stop before the shared approved budget, read from ai_usage, runs out
 *            --case id,id without --set picks from every vision case
 *            --claim-path --replay-root <new folder>: the claim path's own setting, as a claim calls it (no model or
 *            effort override), in two cells: A with both reviewers on Opus 5.5, and B with REMEDY_REVIEWER_MODEL_REMEDY
 *            set to Sonnet 5.5. Each trial replays from its own folder under the root, so B re-reads A's vision report
 *            and Product vote of the same trial at no charge and only the Remedy reviewer's model differs. Each vote
 *            records the model that served it and its cited evidence; each call is priced by that model. Writes
 *            content/verify/reviewer-models.json.
 *
 * Cells differ only in model and effort; every cell runs the identical cases in the same order, with the
 * verification cache off. Cases for one recall run back to back, so the recall prefix is read from the prompt cache
 * after its first claim. The deterministic checks (C3 hashes, C5, C6, the decision) are the same code in every cell.
 * With AI_CACHE_DIR set, an identical request replays from disk at no cost, so a rerun after a crash does not pay
 * twice; pass --fresh for repeat trials. Writes content/verify/sweep-results.json.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { knownAnswer } from "../../src/components/evidence/errors";
import { compareReviewerModels, type ModelRow } from "../../src/components/evidence/reviewer-models";
import { MODEL } from "../../src/lib/ai/claude";
import { capFromArgs, costUsd, spendSince } from "../../src/lib/ai/usage";
import { verifyPhoto, type VerifyResult } from "../../src/lib/verify";
import { fixtureFile, FIXTURES_DIR, loadFixtureCases, loadFixtureRecalls, loadUserCases, meetsExpectation, type FixtureCase } from "../../src/lib/verify/fixtures";
import { claimMaxSide, decodeImage } from "../../src/lib/verify/image";
import { loadOfficialImages, pickForVision } from "../../src/lib/verify/official";
import { REVIEWER_MODEL_ENV, reviewParams, runReviewers, type ReviewArgs, type ReviewRun } from "../../src/lib/verify/reviewers";
import { runVision, visionParams, type Effort, type VisionArgs, type VisionRun } from "../../src/lib/verify/vision";

/** `claimPath`: call vision and the reviewers as a claim does, with no model or effort override; `env` is set for the cell only. */
type Config = { id: string; model: string; effort?: Effort; note: string; claimPath?: boolean; env?: Record<string, string> };
export const CONFIGS: Config[] = [
  { id: "opus-medium", model: "claude-opus-5-5", effort: "medium", note: "today's setting" },
  { id: "opus-low", model: "claude-opus-5-5", effort: "low", note: "same model, less thinking" },
  { id: "sonnet-default", model: "claude-sonnet-5-5", note: "Sonnet 5.5 at its own default effort (high)" },
  { id: "haiku-medium", model: "claude-haiku-5-5", effort: "medium", note: "Haiku 5.5 at its default (medium)" },
];

/**
 * Output tokens per call for the estimate. Opus 5.5 at medium is measured: 548 to 1,150 output tokens on the four
 * live vision calls in ai_usage (2026-11-05); 1,000 is used. The others are assumptions until the sweep measures them.
 */
const OUTPUT_GUESS: Record<string, number> = { "opus-medium": 1000, "opus-low": 700, "sonnet-default": 1500, "haiku-medium": 1200 };

/**
 * --claim-path cells: the claim path's own setting with each reviewer on the model its setting names (reviewerModel).
 * A keeps the default; B sets REMEDY_REVIEWER_MODEL_REMEDY for the cell, as an operator would in the environment.
 */
export const CLAIM_PATH_CONFIGS: Config[] = [
  { id: "A", model: MODEL, claimPath: true, env: {}, note: "Both reviewers on Claude Opus 5.5, the default setting." },
  { id: "B", model: MODEL, claimPath: true, env: { [REVIEWER_MODEL_ENV.remedy]: "claude-sonnet-5-5" }, note: "The Remedy reviewer on Claude Sonnet 5.5 (REMEDY_REVIEWER_MODEL_REMEDY), the Product reviewer unchanged." },
];
/** Output tokens per call by model, for the --claim-path estimate: Opus 5.5 at medium as above; Sonnet 5.5 at its own default is assumed. */
const OUTPUT_BY_MODEL: Record<string, number> = { "claude-opus-5-5": 1000, "claude-sonnet-5-5": 1500 };

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const run = process.argv.includes("--run");
const yes = process.argv.includes("--yes");
const trials = Number(arg("--trials") ?? 1);
const maxUsd = Number(arg("--max-usd") ?? 3);
const only = arg("--config")?.split(",");
/** The shared measurement cap, checked against ai_usage before every case (--cap-usd and --since). */
const budget = capFromArgs(process.argv);
/** Stop while this much is still left: one case with both reviewers on Opus 5.5 costs about $0.15. */
const MARGIN_USD = 0.25;
/** Number this run's trials from N + 1, to add repeat trials to an earlier run (with --merge-with). */
const trialOffset = Number(arg("--trial-offset") ?? 0);
/** An earlier results file whose other trials are kept in the output. */
const mergeWith = arg("--merge-with");
/** A named case set: the fixture cases with sweep: "<set>", run on their own and written to sweep-<set>.json. */
const set = arg("--set");
/** The claim path's own setting in two cells (CLAIM_PATH_CONFIGS), each trial replaying from its own folder under --replay-root. */
const claimPath = process.argv.includes("--claim-path");
const replayRoot = arg("--replay-root");
const OUT = claimPath ? "reviewer-models.json" : set ? `sweep-${set}.json` : "sweep-results.json";
/** Only these fixture case ids, for adding photos to a set without running the others again. */
const onlyCases = arg("--case")?.split(",").filter(Boolean);
if (claimPath && (!replayRoot || (existsSync(replayRoot) && readdirSync(replayRoot).length > 0))) {
  // A must call the model for every request; an older replay would hand it an earlier answer.
  throw new Error("--claim-path needs --replay-root <a new, empty folder>.");
}
if (process.argv.includes("--fresh") || replayRoot) {
  if (!replayRoot) delete process.env.AI_CACHE_DIR;
  // A local proxy (for example headroom on 127.0.0.1) can answer a repeated identical request from its own cache, which
  // makes a repeat trial a copy of the first. Repeat trials go straight to the API, as the hosted app does.
  const base = process.env.ANTHROPIC_BASE_URL ?? "";
  if (/^https?:\/\/(127\.|localhost|\[::1\])/i.test(base)) {
    delete process.env.ANTHROPIC_BASE_URL;
    console.log("--fresh: calling api.anthropic.com directly, not the local proxy, so repeat trials are real samples.");
  }
}

const recalls = loadFixtureRecalls();
const claimContext = { firmAmount: { value: "34.99", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } };

/** Vision cases with a known answer, grouped by recall so the prompt cache is read within a cell. */
function sweepCases(): FixtureCase[] {
  const vision = [...loadFixtureCases(), ...loadUserCases()].filter((c) => c.needs_vision);
  const chosen = set ? vision.filter((c) => c.sweep === set) : onlyCases ? vision : vision.filter((c) => c.sweep === undefined || c.sweep === true);
  return chosen.filter((c) => !onlyCases || onlyCases.includes(c.id)).sort((a, b) => a.recall.localeCompare(b.recall));
}

/** The replay key replayable() in src/lib/ai/claude.ts uses: the same request returns the stored answer at no charge. */
const replayKey = (params: unknown) => createHash("sha256").update(JSON.stringify(params)).digest("hex");
const inReplay = (params: unknown) => Boolean(process.env.AI_CACHE_DIR) && existsSync(path.join(process.env.AI_CACHE_DIR!, `${replayKey(params)}.json`));

/** Set a cell's environment (both reviewer-model settings cleared first) and return a function that puts it back. */
function enterCell(cfg: Config): () => void {
  if (!cfg.claimPath) return () => {};
  const names = Object.values(REVIEWER_MODEL_ENV);
  const before = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  Object.assign(process.env, cfg.env ?? {});
  return () => {
    for (const n of names) {
      if (before[n] === undefined) delete process.env[n];
      else process.env[n] = before[n];
    }
  };
}

/**
 * --claim-path estimate (count_tokens, free): every case is assumed to reach the reviewers (an upper bound), each
 * request is priced at the model it names, and a request an earlier cell of the trial already made is free (replayed).
 */
async function estimateClaimPath(configs: Config[], cases: FixtureCase[]) {
  const client = new Anthropic();
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  for (const cfg of configs) {
    const leave = enterCell(cfg);
    let usd = 0;
    const calls: string[] = [];
    try {
      for (const c of cases) {
        const { recall, rule } = recalls[c.recall];
        const photo = (await decodeImage(fixtureFile(c.photo), claimMaxSide(rule.must_show))).jpeg;
        const official = pickForVision((await loadOfficialImages(recall.images, undefined, 5)).images);
        const v = visionParams({ photo, recall, rule, official });
        const reqs = [{ what: "vision", p: v }, ...(["product", "remedy"] as const).map((who) => ({ what: who, p: reviewParams(who, { photo, recall, rule, official }) }))];
        for (const { what, p } of reqs) {
          const k = replayKey(p);
          if (seen.has(k)) continue;
          seen.add(k);
          const counted = await client.beta.messages.countTokens({ model: p.model, system: p.system, messages: p.messages, output_config: { format: p.output_config.format } });
          usd += costUsd(p.model, { input_tokens: counted.input_tokens, output_tokens: OUTPUT_BY_MODEL[p.model] ?? 1500 });
          calls.push(`${what}:${p.model}`);
        }
      }
    } finally {
      leave();
    }
    total += usd * trials;
    rows.push({ cell: cfg.id, "live calls per trial": calls.length, models: [...new Set(calls)].join(" "), "expected USD per trial": Number(usd.toFixed(3)), trials, "expected USD": Number((usd * trials).toFixed(3)) });
  }
  console.table(rows);
  console.log(`Upper bound: $${total.toFixed(2)} for ${trials} trial(s), every case reaching the reviewers, all input uncached. --max-usd ${maxUsd} and --cap-usd stop the run.`);
  return { rows, total };
}

async function estimate(configs: Config[], cases: FixtureCase[]) {
  if (claimPath) return estimateClaimPath(configs, cases);
  const client = new Anthropic();
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  for (const cfg of configs) {
    let usd = 0;
    let inTok = 0;
    const seen = new Set<string>();
    for (const c of cases) {
      const { recall, rule } = recalls[c.recall];
      const photo = (await decodeImage(fixtureFile(c.photo), claimMaxSide(rule.must_show))).jpeg;
      const official = pickForVision((await loadOfficialImages(recall.images, undefined, 5)).images);
      const p = visionParams({ photo, recall, rule, official, model: cfg.model, effort: cfg.effort });
      const counted = await client.beta.messages.countTokens({ model: cfg.model, system: p.system, messages: p.messages, output_config: { format: p.output_config.format } });
      const cut = p.messages[0].content.findIndex((b) => "cache_control" in b && b.cache_control) + 1;
      const prefix = await client.beta.messages.countTokens({ model: cfg.model, system: p.system, messages: [{ role: "user", content: p.messages[0].content.slice(0, cut) }], output_config: { format: p.output_config.format } });
      const unique = counted.input_tokens - prefix.input_tokens;
      // First claim on a recall writes its prefix to the cache; later ones read it.
      const first = !seen.has(c.recall);
      seen.add(c.recall);
      const usage = first
        ? { input_tokens: unique, cache_creation_input_tokens: prefix.input_tokens, output_tokens: OUTPUT_GUESS[cfg.id] }
        : { input_tokens: unique, cache_read_input_tokens: prefix.input_tokens, output_tokens: OUTPUT_GUESS[cfg.id] };
      usd += costUsd(cfg.model, usage);
      inTok += counted.input_tokens;
      // Firm-review answers bring in the Two reviewers: two more calls of about the same size.
      if (c.expect.decision === "firm_review" || c.expect.not_decision === "verified") {
        for (const who of ["product", "remedy"] as const) {
          const rp = reviewParams(who, { photo, recall, rule, official, model: cfg.model, effort: cfg.effort });
          const rc = await client.beta.messages.countTokens({ model: cfg.model, system: rp.system, messages: rp.messages, output_config: { format: rp.output_config.format } });
          usd += costUsd(cfg.model, { input_tokens: rc.input_tokens, output_tokens: OUTPUT_GUESS[cfg.id] });
        }
      }
    }
    total += usd * trials;
    rows.push({ config: cfg.id, model: cfg.model, effort: cfg.effort ?? "default", cases: cases.length, "input tokens (all cases)": inTok, "assumed output per call": OUTPUT_GUESS[cfg.id], "expected USD per trial": Number(usd.toFixed(3)), trials, "expected USD": Number((usd * trials).toFixed(3)) });
  }
  console.table(rows);
  console.log(`Expected total: $${total.toFixed(2)} for ${trials} trial(s) of ${configs.length} configurations (direct calls, 5-minute prompt cache). Upper bound: --max-usd ${maxUsd} stops the run.`);
  return { rows, total };
}

/** Room left under the shared measurement cap (ai_usage since --since), or Infinity when no cap is given. */
async function roomLeft(): Promise<number> {
  if (!budget) return Number.POSITIVE_INFINITY;
  return budget.cap - (await spendSince(budget.since)).usd;
}

async function sweep(configs: Config[], cases: FixtureCase[]) {
  const startedAt = new Date();
  let spent = 0;
  const results: Record<string, unknown>[] = [];
  const perCase: Record<string, unknown>[] = [];
  let stopped: string | null = null;
  // Trials from an earlier run that this run does not repeat are kept, so repeat trials can be added later.
  // A named set adds to its own file: the rows for the cases and settings this run repeats are replaced, all others kept.
  const setFile = path.join(FIXTURES_DIR, "..", OUT);
  const priorFile = mergeWith ?? (set && existsSync(setFile) ? setFile : null);
  const prior = priorFile ? (JSON.parse(readFileSync(priorFile, "utf8")) as { summary: Record<string, unknown>[]; cases: Record<string, unknown>[]; runs?: unknown[]; spentUsd?: number }) : null;
  const inTrials = (t: unknown) => typeof t === "number" && t > trialOffset && t <= trialOffset + trials;
  const ranCases = new Set(cases.map((c) => c.id));
  const ranConfigs = new Set(configs.map((c) => c.id));
  const mine = (row: Record<string, unknown>) => inTrials(row.trial) && (!set || (ranCases.has(String(row.case)) && ranConfigs.has(String(row.config))));
  const keptCases = () => prior?.cases.filter((c) => !mine(c)) ?? [];
  /** For a named set, each setting and trial is scored again over all of its rows, kept and new. */
  const setSummary = (rows: Record<string, unknown>[]) => {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) groups.set(`${r.config}|${r.trial}`, [...(groups.get(`${r.config}|${r.trial}`) ?? []), r]);
    return [...groups.values()].map((g) => {
      const pass = g.filter((r) => r.ok).length;
      const usd = g.reduce((s, r) => s + Number(r.usd ?? 0), 0);
      const ms = g.map((r) => Number(r.ms ?? 0)).sort((a, b) => a - b);
      return { config: g[0].config, trial: g[0].trial, pass, of: g.length, "pass %": Math.round((pass / g.length) * 100), usd: Number(usd.toFixed(3)), "usd per case": Number((usd / g.length).toFixed(4)), "median ms": ms[Math.floor((ms.length - 1) / 2)] ?? null };
    });
  };
  /** For --claim-path: the spend the ai_usage table logged since this run began, and the A-against-B comparison. */
  const claimPathExtras = async () => {
    if (!claimPath) return {};
    const measured = await spendSince(startedAt).catch(() => null);
    const rows = [...keptCases(), ...perCase] as unknown as ModelRow[];
    return {
      note: "The claim path's own setting, run twice per trial (scripts/verify/sweep.ts --claim-path). A: both reviewers on Claude Opus 5.5. B: the Remedy reviewer on Claude Sonnet 5.5, the Product reviewer unchanged; B re-read A's vision report and Product vote for the same trial from the replay cache, so the Remedy reviewer's model is the only difference. usd is the list price of a claim's calls at that setting; paid_usd is what this run paid (replayed calls cost nothing). Known answers from content/verify/fixtures/cases.json.",
      comparison: compareReviewerModels(rows, Object.fromEntries(configs.map((c) => [c.id, c.note]))),
      aiUsage: measured ? { since: startedAt.toISOString(), usd: Number(measured.usd.toFixed(6)), calls: measured.calls } : null,
    };
  };
  /** When this run started: the file's date, and its own entry's in `runs` (earlier runs keep theirs). */
  const now = new Date().toISOString();
  const save = async () => {
    const extras = await claimPathExtras();
    writeFileSync(
      path.join(FIXTURES_DIR, "..", OUT),
      JSON.stringify(
        {
          ranAt: now,
          trials: trialOffset + trials,
          configs,
          stopped,
          runs: [...(prior?.runs ?? (prior ? [{ trials: "earlier", note: "kept from --merge-with" }] : [])), { trials: `${trialOffset + 1} to ${trialOffset + trials}`, ranAt: now, ...(set ? { cases: [...ranCases] } : {}), direct: !process.env.ANTHROPIC_BASE_URL, spentUsd: Number(spent.toFixed(4)) }],
          summary: set ? setSummary([...keptCases(), ...perCase]) : [...(prior?.summary.filter((s) => !inTrials(s.trial)) ?? []), ...results],
          cases: [...keptCases(), ...perCase],
          spentUsd: Number((spent + (set ? (prior?.spentUsd ?? 0) : 0)).toFixed(4)),
          ...extras,
        },
        null,
        1,
      ) + "\n",
    );
  };
  // Trials outermost: each trial runs every configuration before the next begins, so a stop at the cap leaves whole trials.
  outer: for (let t = trialOffset + 1; t <= trialOffset + trials; t++) {
    // Each trial replays from its own folder, so a later cell of the trial re-reads the requests it shares with an earlier one.
    if (replayRoot) process.env.AI_CACHE_DIR = path.join(replayRoot, `trial-${t}`);
    for (const cfg of configs) {
      let pass = 0;
      let usd = 0;
      const times: number[] = [];
      const leave = enterCell(cfg);
      try {
        for (const c of cases) {
          const left = await roomLeft();
          if (spent >= maxUsd || left < MARGIN_USD) {
            stopped = `Stopped before ${cfg.id} trial ${t} ${c.id}: $${spent.toFixed(3)} spent by this run, $${left.toFixed(3)} left under the cap.`;
            break outer;
          }
          const { recall, rule } = recalls[c.recall];
          // What each call returned, kept to record the model that served each vote and whether it was replayed.
          const got: { vision: VisionRun | null; review: ReviewRun | null; replayed: Record<string, boolean> } = { vision: null, review: null, replayed: {} };
          const visionArgs = (a: VisionArgs): VisionArgs => (cfg.claimPath ? a : { ...a, model: cfg.model, effort: cfg.effort });
          const reviewArgs = (a: ReviewArgs): ReviewArgs => (cfg.claimPath ? a : { ...a, model: cfg.model, effort: cfg.effort });
          const r: VerifyResult = await verifyPhoto(
            { photo: fixtureFile(c.photo), recall, proofRule: rule, claimContext, options: { officialHashCheck: c.official_hash_check, cache: false } },
            {
              vision: async (a) => (got.vision = await runVision(visionArgs(a))),
              reviewers: async (a) => {
                for (const who of ["product", "remedy"] as const) got.replayed[who] = inReplay(reviewParams(who, reviewArgs(a)));
                return (got.review = await runReviewers(reviewArgs(a)));
              },
              cache: null,
              overBudget: async () => ({ over: spent >= maxUsd, usd: spent, budget: maxUsd }),
            },
          );
          // Each call priced by the model that served it; a replayed call is listed at its price but paid nothing.
          const visionUsd = costUsd(got.vision?.model ?? cfg.model, r.usage.vision);
          const reviewUsd = (got.review?.reviews ?? []).map((v) => ({ who: v.reviewer, usd: costUsd(v.model, v.usage) }));
          const reviewersUsd = reviewUsd.reduce((s, x) => s + x.usd, 0);
          const callUsd = visionUsd + reviewersUsd;
          const paidUsd = (got.vision?.replayed ? 0 : visionUsd) + reviewUsd.reduce((s, x) => s + (got.replayed[x.who] ? 0 : x.usd), 0);
          usd += callUsd;
          spent += paidUsd;
          const m = meetsExpectation(c.expect, r);
          if (m.ok) pass++;
          if (r.timings.vision_ms > 0) times.push(r.timings.total_ms);
          perCase.push({
            config: cfg.id,
            trial: t,
            case: c.id,
            ok: m.ok,
            misses: m.misses.join("; "),
            decision: r.decision,
            decided_by: r.decided_by,
            C1: r.checks.C1.score ?? r.checks.C1.status,
            C1_status: r.checks.C1.status,
            C2: r.checks.C2.status,
            C3: r.checks.C3.status,
            C4: r.checks.C4.status,
            C1_reason: r.checks.C1.reason_technical.slice(0, 400),
            C2_reason: r.checks.C2.reason_technical.slice(0, 400),
            C3_reason: r.checks.C3.reason_technical.slice(0, 240),
            referee: r.review?.referee.decision ?? null,
            // What each reviewer said on its own, the model that served it and the evidence it cited, so a later reading can
            // set one reviewer against the referee, or one model against another.
            votes:
              got.review?.votes.map((v, i) => ({
                reviewer: v.reviewer,
                model: got.review!.reviews[i].model,
                answer: v.answer,
                confidence: v.confidence,
                counted: v.counted,
                set_aside: v.setAsideReason ?? null,
                evidence: v.evidence,
                model_read: v.model_read ?? null,
                marker_text_read: v.marker_text_read ?? null,
                replayed: got.replayed[v.reviewer],
              })) ?? null,
            ...(claimPath ? { known: knownAnswer(c.expect, c.photo) ?? "reading", vision_model: got.vision?.model ?? null, vision_replayed: Boolean(got.vision?.replayed) } : {}),
            usd: Number(callUsd.toFixed(4)),
            reviewers_usd: Number(reviewersUsd.toFixed(4)),
            paid_usd: Number(paidUsd.toFixed(4)),
            ms: r.timings.total_ms,
            vision_ms: r.timings.vision_ms,
            usage: r.usage,
          });
          const votes = got.review ? got.review.votes.map((v, i) => `${v.reviewer} ${got.review!.reviews[i].model} ${v.answer}${v.counted ? "" : " (set aside)"}`).join(", ") : "no review";
          console.log(`${cfg.id} #${t} ${c.id}: ${m.ok ? "ok" : `MISS (${m.misses.join("; ")})`} ${r.decision} [${votes}] $${callUsd.toFixed(4)} listed, $${paidUsd.toFixed(4)} paid, ${r.timings.total_ms} ms`);
        }
      } finally {
        leave();
      }
      times.sort((a, b) => a - b);
      results.push({ config: cfg.id, trial: t, pass, of: cases.length, "pass %": Math.round((pass / cases.length) * 100), usd: Number(usd.toFixed(3)), "usd per case": Number((usd / cases.length).toFixed(4)), "median ms": times[Math.floor((times.length - 1) / 2)] ?? null });
      await save();
    }
  }
  if (stopped) console.log(stopped);
  console.table(results);
  await save();
  console.log(`Spent $${spent.toFixed(3)} by this run. Results in content/verify/${OUT}.`);
}

(async () => {
  const configs = (claimPath ? CLAIM_PATH_CONFIGS : CONFIGS).filter((c) => !only || only.includes(c.id));
  const cases = sweepCases();
  console.log(`${cases.length} known-answer vision cases: ${cases.map((c) => c.id).join(", ")}`);
  const est = await estimate(configs, cases);
  if (!run) {
    console.log("Estimate only. Nothing was spent. Rerun with --run --yes after approval.");
    return;
  }
  if (!yes) throw new Error(`This spends about $${est.total.toFixed(2)}. Add --yes once the spend is approved.`);
  await sweep(configs, cases);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
