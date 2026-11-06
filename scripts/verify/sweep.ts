/**
 * Verification sweep (cost tradeoff H): the same known-answer fixture cases through four model and effort settings,
 * scored on whether each decision matches its expected answer, with cost and time per case.
 *
 *   npx tsx --env-file=.env.local scripts/verify/sweep.ts                 estimate only, free (count_tokens)
 *   npx tsx --env-file=.env.local scripts/verify/sweep.ts --run --yes     spends real money; get approval first
 *   options: --config opus-low,haiku-medium   --trials 3   --max-usd 3   --fresh (ignore AI_CACHE_DIR replays)
 *            --cap-usd 4.75 --since <ISO time>: stop before the shared approved budget, read from ai_usage, runs out
 *
 * Cells differ only in model and effort; every cell runs the identical cases in the same order, with the
 * verification cache off. Cases for one recall run back to back, so the recall prefix is read from the prompt cache
 * after its first claim. The deterministic checks (C3 hashes, C5, C6, the decision) are the same code in every cell.
 * With AI_CACHE_DIR set, an identical request replays from disk at no cost, so a rerun after a crash does not pay
 * twice; pass --fresh for repeat trials. Writes content/verify/sweep-results.json.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { capFromArgs, costUsd, spendSince } from "../../src/lib/ai/usage";
import { verifyPhoto, type VerifyResult } from "../../src/lib/verify";
import { fixtureFile, FIXTURES_DIR, loadFixtureCases, loadFixtureRecalls, loadUserCases, meetsExpectation, type FixtureCase } from "../../src/lib/verify/fixtures";
import { claimMaxSide, decodeImage } from "../../src/lib/verify/image";
import { loadOfficialImages, pickForVision } from "../../src/lib/verify/official";
import { reviewParams, runReviewers } from "../../src/lib/verify/reviewers";
import { runVision, visionParams, type Effort } from "../../src/lib/verify/vision";

type Config = { id: string; model: string; effort?: Effort; note: string };
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
if (process.argv.includes("--fresh")) {
  delete process.env.AI_CACHE_DIR;
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
  return [...loadFixtureCases(), ...loadUserCases()].filter((c) => c.needs_vision && c.sweep !== false).sort((a, b) => a.recall.localeCompare(b.recall));
}

async function estimate(configs: Config[], cases: FixtureCase[]) {
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
  let spent = 0;
  const results: Record<string, unknown>[] = [];
  const perCase: Record<string, unknown>[] = [];
  let stopped: string | null = null;
  // Trials from an earlier run that this run does not repeat are kept, so repeat trials can be added later.
  const prior = mergeWith ? (JSON.parse(readFileSync(mergeWith, "utf8")) as { summary: Record<string, unknown>[]; cases: Record<string, unknown>[]; runs?: unknown[] }) : null;
  const mine = (t: unknown) => typeof t === "number" && t > trialOffset && t <= trialOffset + trials;
  const save = () =>
    writeFileSync(
      path.join(FIXTURES_DIR, "..", "sweep-results.json"),
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          trials: trialOffset + trials,
          configs,
          stopped,
          runs: [...(prior?.runs ?? (prior ? [{ trials: "earlier", note: "kept from --merge-with" }] : [])), { trials: `${trialOffset + 1} to ${trialOffset + trials}`, direct: !process.env.ANTHROPIC_BASE_URL, spentUsd: Number(spent.toFixed(4)) }],
          summary: [...(prior?.summary.filter((s) => !mine(s.trial)) ?? []), ...results],
          cases: [...(prior?.cases.filter((c) => !mine(c.trial)) ?? []), ...perCase],
          spentUsd: Number(spent.toFixed(4)),
        },
        null,
        1,
      ) + "\n",
    );
  // Trials outermost: each trial runs every configuration before the next begins, so a stop at the cap leaves whole trials.
  outer: for (let t = trialOffset + 1; t <= trialOffset + trials; t++) {
    for (const cfg of configs) {
      let pass = 0;
      let usd = 0;
      const times: number[] = [];
      for (const c of cases) {
        const left = await roomLeft();
        if (spent >= maxUsd || left < MARGIN_USD) {
          stopped = `Stopped before ${cfg.id} trial ${t} ${c.id}: $${spent.toFixed(3)} spent by this run, $${left.toFixed(3)} left under the cap.`;
          break outer;
        }
        const { recall, rule } = recalls[c.recall];
        const r: VerifyResult = await verifyPhoto(
          { photo: fixtureFile(c.photo), recall, proofRule: rule, claimContext, options: { officialHashCheck: c.official_hash_check, cache: false } },
          {
            vision: (a) => runVision({ ...a, model: cfg.model, effort: cfg.effort }),
            reviewers: (a) => runReviewers({ ...a, model: cfg.model, effort: cfg.effort }),
            cache: null,
            overBudget: async () => ({ over: spent >= maxUsd, usd: spent, budget: maxUsd }),
          },
        );
        const callUsd = [r.usage.vision, ...r.usage.reviewers].reduce((s, u) => s + costUsd(cfg.model, u), 0);
        usd += callUsd;
        spent += callUsd;
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
          usd: Number(callUsd.toFixed(4)),
          ms: r.timings.total_ms,
          vision_ms: r.timings.vision_ms,
          usage: r.usage,
        });
        console.log(`${cfg.id} #${t} ${c.id}: ${m.ok ? "ok" : `MISS (${m.misses.join("; ")})`} ${r.decision} $${callUsd.toFixed(4)} ${r.timings.total_ms} ms`);
      }
      times.sort((a, b) => a - b);
      results.push({ config: cfg.id, trial: t, pass, of: cases.length, "pass %": Math.round((pass / cases.length) * 100), usd: Number(usd.toFixed(3)), "usd per case": Number((usd / cases.length).toFixed(4)), "median ms": times[Math.floor((times.length - 1) / 2)] ?? null });
      save();
    }
  }
  if (stopped) console.log(stopped);
  console.table(results);
  save();
  console.log(`Spent $${spent.toFixed(3)} by this run. Results in content/verify/sweep-results.json.`);
}

(async () => {
  const configs = CONFIGS.filter((c) => !only || only.includes(c.id));
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
