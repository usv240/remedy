/**
 * Proof-rule model sweep (cost tradeoff G): the 130-recall benchmark sample through Claude Haiku 5.5 and Claude
 * Sonnet 5.5, with the same prompt, schema, effort and scoring as the Opus 5.5 results already in
 * content/recalls/extract/plain.json. Message Batches API (half price).
 *
 *   npx tsx --env-file=.env.local scripts/recalls/model-sweep.ts                 estimate only, free
 *   npx tsx --env-file=.env.local scripts/recalls/model-sweep.ts --run --yes     spends real money; get approval first
 *   options: --models haiku,sonnet   --effort medium   --cap-usd 4.75 --since <ISO time> (shared approved budget)
 *
 * The estimate uses the measured Opus 5.5 usage on the same 130 requests (mean 3,288 input and 453 output tokens) and
 * assumes up to twice the output for the smaller models. A batch is remembered in
 * content/recalls/extract/sweep-batches.json, so a rerun resumes it instead of paying twice. Writes
 * content/recalls/extract/sweep-<model>.json and content/recalls/benchmark/model-sweep.json.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { capFromArgs, costUsd, spendSince } from "../../src/lib/ai/usage";
import { runBatch } from "../../src/lib/recall/batch";
import { SCORED_FIELDS, scoreVariant, type LabelRecord } from "../../src/lib/recall/bench";
import { batchRequest, parseRuleMessage, type ProofRule } from "../../src/lib/recall/proof-rule";
import type { RecallsFile } from "../../src/lib/recall/types";
import type { RawOutput, RawOutputsFile } from "./extract";

const MODELS: Record<string, string> = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5" };
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const run = process.argv.includes("--run");
const yes = process.argv.includes("--yes");
const effort = (arg("--effort") ?? "medium") as "low" | "medium" | "high";
const pick = (arg("--models") ?? "haiku,sonnet").split(",").filter((m) => MODELS[m]);
/** The shared measurement cap (--cap-usd and --since), read from ai_usage before each batch is submitted. */
const budget = capFromArgs(process.argv);

const dir = path.join(process.cwd(), "content", "recalls");
const read = <T>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;
const recalls = read<RecallsFile>(path.join(dir, "recalls.json")).recalls;
const byNum = new Map(recalls.map((r) => [r.number, r]));
const labels = Object.values(read<{ labels: Record<string, LabelRecord> }>(path.join(dir, "benchmark", "labels.draft.json")).labels);
const opus = read<RawOutputsFile>(path.join(dir, "extract", "plain.json"));

const used = labels.map((l) => opus.outputs[l.number]?.usage).filter((u): u is NonNullable<typeof u> => Boolean(u));
const meanIn = used.reduce((s, u) => s + u.input_tokens, 0) / used.length;
const meanOut = used.reduce((s, u) => s + u.output_tokens, 0) / used.length;
/** The upper estimate for one model on the whole sample: Opus's measured input, twice its output, batch prices. */
const upperFor = (model: string) => labels.length * costUsd(model, { input_tokens: meanIn, output_tokens: meanOut * 2 }, { batch: true });

function estimate() {
  const rows = pick.map((k) => {
    const m = MODELS[k];
    const at = (outFactor: number) => labels.length * costUsd(m, { input_tokens: meanIn, output_tokens: meanOut * outFactor }, { batch: true });
    return { model: m, effort, requests: labels.length, "mean input (Opus measured)": Math.round(meanIn), "mean output (Opus measured)": Math.round(meanOut), "USD at Opus output": Number(at(1).toFixed(3)), "USD at 2x output": Number(at(2).toFixed(3)) };
  });
  const opusUsd = labels.length * costUsd("claude-opus-5-5", { input_tokens: meanIn, output_tokens: meanOut }, { batch: true });
  console.table(rows);
  console.log(`For comparison, the Opus 5.5 run on the same sample cost about $${opusUsd.toFixed(2)} at batch prices.`);
  return rows.reduce((s, r) => s + r["USD at 2x output"], 0);
}

function collect(items: Awaited<ReturnType<typeof runBatch>>["items"], prefix: string): Record<string, RawOutput> {
  const out: Record<string, RawOutput> = {};
  for (const it of items) {
    const num = it.customId.slice(prefix.length + 1);
    if (!it.ok) {
      out[num] = { rule: null, raw: "", usage: null, stopReason: null, model: null, error: it.error };
      continue;
    }
    const m = it.message;
    try {
      const { rule, raw } = parseRuleMessage(m.content as { type: string; text?: string }[], m.stop_reason);
      out[num] = { rule, raw, usage: m.usage, stopReason: m.stop_reason, model: m.model, error: null };
    } catch (e) {
      out[num] = { rule: null, raw: "", usage: m.usage, stopReason: m.stop_reason, model: m.model, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

async function sweep() {
  const client = new Anthropic();
  const table: Record<string, Record<string, number | string>> = {};
  const score = (name: string, rules: Record<string, ProofRule | null>, usd: number) => {
    const s = scoreVariant(labels, rules);
    table[name] = { allFields: s.allFieldsCorrect.rate, ...Object.fromEntries(SCORED_FIELDS.map((k) => [k, s.fields[k].accuracy])), actionsF1: s.actions.f1, mustShowF1: s.mustShow.f1, missing: s.missing, usd: Number(usd.toFixed(3)) };
  };
  const opusUsd = labels.reduce((s, l) => s + costUsd("claude-opus-5-5", opus.outputs[l.number]?.usage ?? null, { batch: true }), 0);
  score("claude-opus-5-5 (existing)", Object.fromEntries(labels.map((l) => [l.number, opus.outputs[l.number]?.rule ?? null])), opusUsd);
  for (const k of pick) {
    const model = MODELS[k];
    const prefix = `sw${k}`;
    if (budget) {
      // Submit only if this model's upper estimate (twice Opus's output) still fits under the shared cap.
      const upper = upperFor(model);
      const s = await spendSince(budget.since);
      if (s.usd + upper > budget.cap) throw new Error(`Stopped before ${model}: $${s.usd.toFixed(3)} spent since ${budget.since.toISOString()}, its upper estimate $${upper.toFixed(3)} would pass the $${budget.cap} cap.`);
    }
    const requests = labels.map((l) => {
      const req = batchRequest(prefix, byNum.get(l.number)!);
      return { ...req, params: { ...req.params, model, output_config: { ...req.params.output_config, effort } } };
    });
    const res = await runBatch({ client, name: `sweep-${k}-${effort}`, stateFile: path.join(dir, "extract", "sweep-batches.json"), requests });
    const outputs = collect(res.items, prefix);
    const file: RawOutputsFile = { model, variant: "plain", mode: "batch", batchId: res.batchId, createdAt: new Date().toISOString(), outputs };
    writeFileSync(path.join(dir, "extract", `sweep-${k}-${effort}.json`), JSON.stringify(file, null, 1));
    const usd = Object.values(outputs).reduce((s, o) => s + costUsd(model, o.usage, { batch: true }), 0);
    score(`${model} (${effort})`, Object.fromEntries(labels.map((l) => [l.number, outputs[l.number]?.rule ?? null])), usd);
  }
  console.table(table);
  writeFileSync(
    path.join(dir, "benchmark", "model-sweep.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), effort, note: "Same prompt, schema and draft labels as results.json; scores share its caveat while labels are unconfirmed.", summary: table }, null, 1),
  );
}

(async () => {
  console.log(`${labels.length} benchmark recalls; models: ${pick.map((k) => MODELS[k]).join(", ")}; effort ${effort}`);
  const upper = estimate();
  if (!run) {
    console.log(`Estimate only, up to about $${upper.toFixed(2)}. Nothing was spent. Rerun with --run --yes after approval.`);
    return;
  }
  if (!yes) throw new Error(`This spends up to about $${upper.toFixed(2)}. Add --yes once the spend is approved.`);
  await sweep();
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
