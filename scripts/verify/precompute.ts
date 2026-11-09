/**
 * Precompute the verification answers for every demo preset (cost free win B), so a visitor pressing a preset costs $0.
 * For each preset that needs Claude:
 *   - with a recording in content/presets/recorded/, the recorded answer seeds the verify_result table, at no cost;
 *   - without one, one live run records it (the /try page replays it) and seeds verify_result.
 * Every check that depends on the claim still runs in code each time. Presets decided before any model call need nothing.
 *
 *   npx tsx --env-file=.env.local scripts/verify/precompute.ts                  plan and expected cost, free
 *   npx tsx --env-file=.env.local scripts/verify/precompute.ts --run --yes      records what is missing
 *   add --cap-usd 4.75 --since <ISO time> to stop before the approved measurement budget (read from ai_usage) runs out
 *   npx tsx scripts/verify/precompute.ts --run --yes --recorded-only            seeds recordings only, never calls Claude
 *                                                                               (Render's pre-deploy runs this)
 *   add --rerecord to record again the recordings made on an earlier engine version (a prompt or schema change made
 *   them stale); a recording that names no engine predates the field and counts as stale. Use it with --cap-usd.
 *
 * Presets come from content/presets/index.json, plus the team's own photos in content/verify/fixtures/user/expected.json.
 */
import { capFromArgs, costUsd, spendSince } from "../../src/lib/ai/usage";
import { dbConfigured } from "../../src/lib/db";
import { getRecall, ruleFor, verifyRecallFor } from "../../src/app/api/claims/_lib/recall";
import { listPresets, presetPhoto, readRecorded, recordPreset, type Preset, type Recorded } from "../../src/app/api/try/_lib/presets";
import { verifyPhoto } from "../../src/lib/verify";
import { cacheKey, dbVerifyCache, engineVersion, photoSha256, ruleVersion } from "../../src/lib/verify/cache";
import { loadFixtureCases, meetsExpectation } from "../../src/lib/verify/fixtures";

const run = process.argv.includes("--run");
const yes = process.argv.includes("--yes");
/** Seed only what is already recorded: no model call, so it is safe in a deploy step. */
const recordedOnly = process.argv.includes("--recorded-only");
/** Record again what was recorded on another engine version. Never together with --recorded-only. */
const rerecord = process.argv.includes("--rerecord") && !recordedOnly;
const budget = capFromArgs(process.argv);
const stale = (rec: Recorded | null) => Boolean(rec?.vision) && rec!.engine !== engineVersion();
/** One Opus 5.5 vision call, from the measured ones in ai_usage ($0.022 to $0.038); a firm review adds two reviewers. */
const PER_CALL = costUsd("claude-opus-5-5", { input_tokens: 1700, cache_creation_input_tokens: 900, cache_read_input_tokens: 3400, output_tokens: 1000 });

type Job = { p: Preset; technical: boolean; recordedName: string | null };

function jobs(): Job[] {
  const all = listPresets();
  const out: Job[] = [];
  for (const p of [...all.presets, ...all.user]) {
    out.push({ p, technical: false, recordedName: p.recorded ?? null });
    if (p.technical) out.push({ p, technical: true, recordedName: p.technical.recorded });
  }
  return out;
}

async function seed(j: Job, rec: Recorded) {
  const recall = getRecall(j.p.recall)!;
  const rule = ruleFor(recall).rule;
  const photo = presetPhoto(j.p).bytes;
  const key = cacheKey({ photoSha256: photoSha256(photo), recallNumber: recall.number, ruleVersion: ruleVersion(rule), engineVersion: engineVersion() });
  if (!rec.vision) return false;
  await dbVerifyCache.put({
    key,
    recallNumber: recall.number,
    photoSha256: photoSha256(photo),
    ruleVersion: ruleVersion(rule),
    engineVersion: engineVersion(),
    decision: rec.decision as "verified" | "retake" | "firm_review",
    result: { vision: rec.vision, reviews: rec.reviews?.reviews ?? null },
    source: "precomputed",
  });
  return true;
}

(async () => {
  if (!dbConfigured()) throw new Error("DATABASE_URL is not set: the precomputed answers live in the verify_result table.");
  const cases = new Map(loadFixtureCases().map((c) => [`${c.recall}|${c.photo}`, c]));
  const plan: { j: Job; needs: boolean; recording: Recorded | null; usd: number }[] = [];
  for (const j of jobs()) {
    const recall = getRecall(j.p.recall);
    if (!recall) throw new Error(`Preset ${j.p.id} names recall ${j.p.recall}, which is not in recalls.json.`);
    const options = j.technical && j.p.technical ? j.p.technical.options : {};
    // A run with no AI shows whether this preset needs Claude at all.
    const dry = await verifyPhoto({ photo: presetPhoto(j.p).bytes, recall: verifyRecallFor(recall), proofRule: ruleFor(recall).rule, options: { ...options, cache: false } }, { aiAvailable: () => false, cache: null });
    const needs = Object.values(dry.checks).some((c) => c.status === "unavailable");
    const recording = j.recordedName ? readRecorded(j.recordedName) : null;
    plan.push({ j, needs, recording, usd: needs && (!recording?.vision || (rerecord && stale(recording))) ? PER_CALL : 0 });
  }
  console.table(
    plan.map((x) => ({
      preset: `${x.j.p.id}${x.j.technical ? " (technical)" : ""}`,
      recall: x.j.p.recall,
      "needs Claude": x.needs,
      recorded: Boolean(x.recording?.vision),
      "this engine": x.recording?.vision ? !stale(x.recording) : "-",
      "expected USD": Number(x.usd.toFixed(3)),
    })),
  );
  const total = plan.reduce((s, x) => s + x.usd, 0);
  console.log(`Expected cost: about $${total.toFixed(2)} (one Opus 5.5 vision call per preset still to record; a firm review would add two reviewer calls).`);
  if (!run) return console.log("Nothing was spent. Rerun with --run --yes after approval.");
  if (!yes) throw new Error(`This spends about $${total.toFixed(2)}. Add --yes once the spend is approved.`);

  const rows: Record<string, unknown>[] = [];
  for (const x of plan.filter((y) => y.needs)) {
    let rec = x.recording;
    let fresh = false;
    if (!rec?.vision || (rerecord && stale(rec))) {
      if (recordedOnly) {
        console.log(`Skipped ${x.j.p.id}: no recording yet, and --recorded-only makes no model call.`);
        continue;
      }
      if (budget) {
        const s = await spendSince(budget.since);
        if (s.usd + PER_CALL * 3 > budget.cap) throw new Error(`Stopped before ${x.j.p.id}: $${s.usd.toFixed(3)} spent since ${budget.since.toISOString()}, cap $${budget.cap}.`);
      }
      if (!x.j.recordedName) throw new Error(`Preset ${x.j.p.id} needs Claude but names no recording file.`);
      rec = await recordPreset(x.j.p, { technical: x.j.technical });
      fresh = true;
    }
    const seeded = await seed(x.j, rec);
    const c = cases.get(`${x.j.p.recall}|${x.j.p.photo}`);
    const replay = await (await import("../../src/app/api/try/_lib/presets")).runPreset(x.j.p, { technical: x.j.technical });
    const checks = Object.fromEntries(replay.result.checks.map((k) => [k.id, { status: k.status, reason_plain: k.reason_plain }]));
    const meets = c && !x.j.technical ? meetsExpectation(c.expect, { decision: replay.result.decision, decided_by: replay.result.decided_by ?? "", checks }) : null;
    const score = (id: string) => replay.result.checks.find((k) => k.id === id);
    rows.push({
      preset: `${x.j.p.id}${x.j.technical ? " (technical)" : ""}`,
      run: fresh ? "recorded now" : "existing recording",
      decision: `${replay.result.decision} (${replay.result.decided_by})`,
      C1: `${score("C1")?.status}${score("C1")?.score !== null && score("C1")?.score !== undefined ? ` ${score("C1")?.score}` : ""}`,
      C2: score("C2")?.status,
      C3: `${score("C3")?.status}${score("C3")?.score !== null && score("C3")?.score !== undefined ? ` ${score("C3")?.score}` : ""}`,
      "meets fixture case": meets ? (meets.ok ? "yes" : `no: ${meets.misses.join("; ")}`) : "n/a",
      usd: fresh ? rec.cost_usd : 0,
      seeded,
    });
  }
  console.table(rows);
  if (budget) console.log(`Spent since ${budget.since.toISOString()}: $${(await spendSince(budget.since)).usd.toFixed(4)} (ai_usage).`);
  process.exit(0);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
