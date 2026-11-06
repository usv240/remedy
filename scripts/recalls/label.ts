/**
 * Pre-label the benchmark sample with a careful second Claude pass (Claude Opus 5.5 at high effort, with word-for-word
 * evidence for every field), then cross-check each label deterministically (evidence and marker text appear literally;
 * actions match keywords). Every field is written with "confirmed": false; a person confirms labels later.
 *
 *   npx tsx --env-file=.env.local scripts/recalls/label.ts [--direct]
 *
 * Writes content/recalls/benchmark/labels.draft.json (and labels.raw.json with the model's raw outputs).
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runBatch, runDirect, type BatchItem } from "../../src/lib/recall/batch";
import { crossCheck, labelParams, parseLabel, SCORED_FIELDS, type LabelRecord } from "../../src/lib/recall/bench";
import { costOf, PROOF_MODEL } from "../../src/lib/recall/proof-rule";
import type { RecallsFile } from "../../src/lib/recall/types";

const dir = path.join(process.cwd(), "content", "recalls");
const benchDir = path.join(dir, "benchmark");
const direct = process.argv.includes("--direct");

async function main() {
  const recalls = (JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as RecallsFile).recalls;
  const sample = JSON.parse(readFileSync(path.join(benchDir, "sample.json"), "utf8")) as { items: { number: string; kind: string }[] };
  const byNum = new Map(recalls.map((r) => [r.number, r]));
  const items = sample.items.map((s) => ({ s, r: byNum.get(s.number)! })).filter((x) => x.r);
  const requests = items.map(({ r }) => ({ custom_id: `l-${r.number}`, params: labelParams(r) }));
  const client = new Anthropic();
  console.log(`Labeling ${requests.length} recalls (${direct ? "direct" : "batch"})`);
  let results: BatchItem[];
  let batchId: string | null = null;
  if (direct) results = await runDirect({ client, requests, concurrency: 4 });
  else ({ items: results, batchId } = await runBatch({ client, name: "labels", stateFile: path.join(benchDir, "batches.json"), requests }));

  const raw: Record<string, { text: string; usage: Anthropic.Usage | null; error: string | null }> = {};
  const labels: Record<string, LabelRecord> = {};
  let cost = 0;
  for (const it of results) {
    const num = it.customId.slice(2);
    const x = items.find((i) => i.r.number === num)!;
    if (!it.ok) {
      raw[num] = { text: "", usage: null, error: it.error };
      continue;
    }
    const text = (it.message.content.find((b) => b.type === "text") as { text?: string } | undefined)?.text ?? "";
    cost += costOf(it.message.usage, !direct);
    try {
      labels[num] = crossCheck(parseLabel(text), x.r, x.s.kind);
      raw[num] = { text, usage: it.message.usage, error: null };
    } catch (e) {
      raw[num] = { text, usage: it.message.usage, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const ordered = Object.fromEntries(items.filter(({ r }) => labels[r.number]).map(({ r }) => [r.number, labels[r.number]]));
  const recs = Object.values(ordered);
  const checks = Object.fromEntries(
    SCORED_FIELDS.map((k) => [
      k,
      {
        pass: recs.filter((l) => l.fields[k].check === "pass").length,
        fail: recs.filter((l) => l.fields[k].check === "fail").length,
        evidenceNotFound: recs.filter((l) => !l.fields[k].evidenceFound).length,
        ambiguous: recs.filter((l) => l.fields[k].ambiguous).length,
      },
    ]),
  );
  writeFileSync(
    path.join(benchDir, "labels.draft.json"),
    JSON.stringify(
      {
        status: "draft",
        note: "Draft labels from a second Claude pass, cross-checked by code. No field is confirmed by a person yet; set confirmed to true field by field after review.",
        createdAt: new Date().toISOString(),
        model: PROOF_MODEL,
        effort: "high",
        batchId,
        method:
          "Claude Opus 5.5 at high effort labels each field under the shared guide (src/lib/recall/proof-rule.ts GUIDE) and quotes the words that settle it. Code then checks that each quote and the marker text appear word for word in the recall text, that each action has its keyword in the remedy, and that marker and cut keywords are not left out.",
        counts: { labeled: recs.length, of: items.length, checks },
        usd: Math.round(cost * 100) / 100,
        labels: ordered,
      },
      null,
      1,
    ),
  );
  writeFileSync(path.join(benchDir, "labels.raw.json"), JSON.stringify(raw, null, 1));
  console.log(`labels.draft.json: ${recs.length}/${items.length} labeled; about $${cost.toFixed(2)}`);
  console.table(checks);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
