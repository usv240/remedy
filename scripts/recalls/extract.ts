/**
 * Extract a proof rule for every photo-refund recall, the 30 most recent non-photo recalls and the benchmark sample,
 * with Claude Opus 5.5 through the Message Batches API (half price). Two passes:
 *   1. plain: the extractor (structured output, medium effort),
 *   2. selfcheck: the same model checks each draft against the remedy text and the deterministic lint, and corrects it.
 *
 *   npx tsx --env-file=.env.local scripts/recalls/extract.ts [--estimate] [--direct] [--limit N]
 *
 * Raw per-recall outputs (text, usage, errors) go to content/recalls/extract/{plain,selfcheck}.json for the benchmark;
 * batch ids are kept in content/recalls/extract/batches.json so a rerun resumes instead of paying twice.
 * The finished rules go to content/recalls/proof-rules.json.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runBatch, runDirect, type BatchItem } from "../../src/lib/recall/batch";
import {
  PROOF_MODEL,
  batchRequest,
  costOf,
  extractBaseline,
  parseRuleMessage,
  proofRuleParams,
  type ProofRule,
} from "../../src/lib/recall/proof-rule";
import type { Recall, RecallsFile } from "../../src/lib/recall/types";

const dir = path.join(process.cwd(), "content", "recalls");
const outDir = path.join(dir, "extract");
const stateFile = path.join(outDir, "batches.json");
const direct = process.argv.includes("--direct");
const estimateOnly = process.argv.includes("--estimate");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

export type RawOutput = {
  rule: ProofRule | null;
  raw: string;
  usage: Anthropic.Usage | null;
  stopReason: string | null;
  model: string | null;
  error: string | null;
};
export type RawOutputsFile = { model: string; variant: "plain" | "selfcheck"; mode: "batch" | "direct"; batchId: string | null; createdAt: string; outputs: Record<string, RawOutput> };

function targets(file: RecallsFile): { list: Recall[]; why: Record<string, string[]> } {
  const why: Record<string, string[]> = {};
  const add = (r: Recall, reason: string) => (why[r.number] ??= []).push(reason);
  for (const r of file.recalls) if (r.photoRefund) add(r, "photo_refund");
  for (const r of file.recalls.filter((x) => !x.flags.photo).slice(0, 30)) add(r, "recent_non_photo");
  const samplePath = path.join(dir, "benchmark", "sample.json");
  if (existsSync(samplePath)) {
    for (const s of (JSON.parse(readFileSync(samplePath, "utf8")) as { items: { number: string }[] }).items) {
      const r = file.recalls.find((x) => x.number === s.number);
      if (r) add(r, "benchmark");
    }
  }
  const list = file.recalls.filter((r) => why[r.number]).slice(0, limit);
  return { list, why };
}

function collect(items: BatchItem[], prefix: string): Record<string, RawOutput> {
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
      const raw = (m.content.find((b) => b.type === "text") as { text?: string } | undefined)?.text ?? "";
      out[num] = { rule: null, raw, usage: m.usage, stopReason: m.stop_reason, model: m.model, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

async function estimate(client: Anthropic, list: Recall[]) {
  // Count the real input tokens of a few requests, then scale by characters for the rest.
  const probe = list.filter((_, i) => i % Math.max(1, Math.floor(list.length / 4)) === 0).slice(0, 4);
  let tokens = 0;
  let chars = 0;
  for (const r of probe) {
    const p = proofRuleParams(r);
    const c = await client.messages.countTokens({ model: p.model, system: p.system, messages: p.messages, output_config: p.output_config });
    tokens += c.input_tokens;
    chars += JSON.stringify(p.messages).length;
  }
  const perChar = tokens / chars;
  const base = tokens / probe.length - perChar * (chars / probe.length);
  const inputPlain = list.reduce((s, r) => s + base + perChar * JSON.stringify(proofRuleParams(r).messages).length, 0);
  const OUT = 1800; // assumed output tokens per call (adaptive thinking at medium effort plus the JSON rule)
  const inputCheck = inputPlain * 1.6; // the self-check pass also carries the draft rule and lint findings
  const calls = list.length * 2;
  const usd = ((inputPlain + inputCheck) * 4 + calls * OUT * 20) / 1e6 / 2;
  return { calls, inputTokens: Math.round(inputPlain + inputCheck), assumedOutputTokens: calls * OUT, usd: Math.round(usd * 100) / 100, perCallInput: Math.round(inputPlain / list.length) };
}

async function stage(client: Anthropic, name: "plain" | "selfcheck", list: Recall[], drafts?: Record<string, RawOutput>): Promise<RawOutputsFile> {
  const prefix = name === "plain" ? "p" : "s";
  const usable = drafts ? list.filter((r) => drafts[r.number]?.rule) : list;
  const requests = usable.map((r) => batchRequest(prefix, r, drafts ? drafts[r.number].rule! : undefined));
  let items: BatchItem[];
  let batchId: string | null = null;
  if (direct) {
    items = await runDirect({ client, requests, concurrency: 4 });
  } else {
    const res = await runBatch({ client, name, stateFile, requests });
    items = res.items;
    batchId = res.batchId;
  }
  const outputs = collect(items, prefix);
  const file: RawOutputsFile = { model: PROOF_MODEL, variant: name, mode: direct ? "direct" : "batch", batchId, createdAt: new Date().toISOString(), outputs };
  writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(file, null, 1));
  const ok = Object.values(outputs).filter((o) => o.rule).length;
  const cost = Object.values(outputs).reduce((s, o) => s + costOf(o.usage, !direct), 0);
  console.log(`[${name}] ${ok}/${requests.length} rules; cost about $${cost.toFixed(2)}`);
  return file;
}

async function main() {
  const file = JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as RecallsFile;
  const { list, why } = targets(file);
  mkdirSync(outDir, { recursive: true });
  const client = new Anthropic();
  const est = await estimate(client, list);
  const counts = {
    photoRefund: list.filter((r) => why[r.number].includes("photo_refund")).length,
    recentNonPhoto: list.filter((r) => why[r.number].includes("recent_non_photo")).length,
    benchmarkOnly: list.filter((r) => why[r.number].length === 1 && why[r.number][0] === "benchmark").length,
  };
  console.log(`Targets: ${list.length} recalls (${counts.photoRefund} photo-refund, ${counts.recentNonPhoto} recent non-photo, ${counts.benchmarkOnly} more from the benchmark sample)`);
  console.log(`Estimate: ${est.calls} calls (two passes), about ${est.inputTokens.toLocaleString("en-US")} input and ${est.assumedOutputTokens.toLocaleString("en-US")} output tokens, about $${est.usd} at batch prices`);
  if (estimateOnly) return;

  const t = Date.now();
  const plain = await stage(client, "plain", list);
  const checked = await stage(client, "selfcheck", list, plain.outputs);

  const rules: Record<string, ProofRule> = {};
  const sources: Record<string, "selfcheck" | "plain" | "baseline"> = {};
  for (const r of list) {
    const s = checked.outputs[r.number]?.rule;
    const p = plain.outputs[r.number]?.rule;
    rules[r.number] = s ?? p ?? extractBaseline(r);
    sources[r.number] = s ? "selfcheck" : p ? "plain" : "baseline";
  }
  const all = [...Object.values(plain.outputs), ...Object.values(checked.outputs)];
  const usage = all.reduce(
    (a, o) => ({ input: a.input + (o.usage?.input_tokens ?? 0), output: a.output + (o.usage?.output_tokens ?? 0) }),
    { input: 0, output: 0 },
  );
  const cost = all.reduce((s, o) => s + costOf(o.usage, !direct), 0);
  writeFileSync(
    path.join(dir, "proof-rules.json"),
    JSON.stringify(
      {
        model: PROOF_MODEL,
        extractedAt: new Date().toISOString(),
        method: "Claude Opus 5.5, structured output at medium effort, then a self-check pass against the remedy text and deterministic lint. Message Batches API.",
        counts: { recalls: list.length, ...counts, bySource: Object.fromEntries(["selfcheck", "plain", "baseline"].map((k) => [k, Object.values(sources).filter((v) => v === k).length])) },
        usage: { calls: all.length, inputTokens: usage.input, outputTokens: usage.output, usd: Math.round(cost * 100) / 100, pricing: direct ? "standard" : "batch (50% off)" },
        minutes: Math.round((Date.now() - t) / 6000) / 10,
        sources,
        rules,
      },
      null,
      1,
    ),
  );
  console.log(`proof-rules.json: ${list.length} rules; ${all.length} calls, ${usage.input.toLocaleString("en-US")} input and ${usage.output.toLocaleString("en-US")} output tokens, about $${cost.toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
