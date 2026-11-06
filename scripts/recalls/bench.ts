/**
 * Score the three proof-rule extractors against the benchmark labels, field by field.
 *
 *   npx tsx scripts/recalls/bench.ts
 *
 * Variants: the deterministic baseline (run now), Claude (content/recalls/extract/plain.json) and Claude with the
 * self-check (content/recalls/extract/selfcheck.json). Labels come from content/recalls/benchmark/labels.draft.json;
 * while any label is unconfirmed the results are marked "draft". Writes content/recalls/benchmark/results.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SCORED_FIELDS, scoreVariant, type LabelRecord, type VariantScore } from "../../src/lib/recall/bench";
import { costOf, extractBaseline, lintRule, type ProofRule } from "../../src/lib/recall/proof-rule";
import type { RecallsFile } from "../../src/lib/recall/types";
import type { RawOutputsFile } from "./extract";

const dir = path.join(process.cwd(), "content", "recalls");
const benchDir = path.join(dir, "benchmark");
const read = <T>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;

const recalls = read<RecallsFile>(path.join(dir, "recalls.json")).recalls;
const byNum = new Map(recalls.map((r) => [r.number, r]));
const labelsFile = read<{ status: string; labels: Record<string, LabelRecord> }>(path.join(benchDir, "labels.draft.json"));
const labels = Object.values(labelsFile.labels);
const confirmed = labels.every((l) => SCORED_FIELDS.every((k) => (l.fields[k] as { confirmed: boolean }).confirmed));
const plain = read<RawOutputsFile>(path.join(dir, "extract", "plain.json"));
const checked = read<RawOutputsFile>(path.join(dir, "extract", "selfcheck.json"));

const pickRules = (f: RawOutputsFile) => Object.fromEntries(labels.map((l) => [l.number, f.outputs[l.number]?.rule ?? null]));
const variants: Record<string, Record<string, ProofRule | null>> = {
  baseline: Object.fromEntries(labels.map((l) => [l.number, extractBaseline(byNum.get(l.number)!)])),
  claude: pickRules(plain),
  claude_selfcheck: pickRules(checked),
};

const summarize = (s: VariantScore) => ({
  n: s.n,
  missing: s.missing,
  allFieldsCorrect: s.allFieldsCorrect,
  fields: Object.fromEntries(SCORED_FIELDS.map((k) => [k, s.fields[k].accuracy])),
  actionsPRF: s.actions,
  mustShowPRF: s.mustShow,
});

const kinds = ["photo_refund", "non_photo"] as const;
const results: Record<string, unknown> = {};
const table: Record<string, Record<string, number | string>> = {};
for (const [name, rules] of Object.entries(variants)) {
  const all = scoreVariant(labels, rules);
  const byKind = Object.fromEntries(kinds.map((k) => [k, summarize(scoreVariant(labels.filter((l) => l.kind === k), rules))]));
  // Fields whose label passed its cross-check and was not flagged ambiguous: the most settled labels.
  const settled = Object.fromEntries(
    SCORED_FIELDS.map((k) => {
      const ls = labels.filter((l) => !l.fields[k].ambiguous && l.fields[k].check !== "fail");
      const s = scoreVariant(ls, rules);
      return [k, { n: ls.length, accuracy: s.fields[k].accuracy }];
    }),
  );
  // Label-free check: deterministic lint findings on each rule (lower is better).
  const lint = labels.map((l) => (rules[l.number] ? lintRule(rules[l.number]!, byNum.get(l.number)!).length : null));
  const usage = name === "baseline" ? null : (name === "claude" ? plain : checked);
  const cost = usage ? labels.reduce((s, l) => s + costOf(usage.outputs[l.number]?.usage ?? null, usage.mode === "batch"), 0) : 0;
  results[name] = {
    ...summarize(all),
    byKind,
    settledLabels: settled,
    lint: { rulesWithFindings: lint.filter((x) => x !== null && x > 0).length, findings: lint.reduce<number>((s, x) => s + (x ?? 0), 0) },
    usdForSample: Math.round(cost * 100) / 100,
    errors: all.errors.slice(0, 200),
  };
  table[name] = {
    allFields: all.allFieldsCorrect.rate,
    ...Object.fromEntries(SCORED_FIELDS.map((k) => [k, all.fields[k].accuracy])),
    actionsF1: all.actions.f1,
    mustShowF1: all.mustShow.f1,
    lintRules: (results[name] as { lint: { rulesWithFindings: number } }).lint.rulesWithFindings,
  };
}

const out = {
  status: confirmed ? "confirmed" : "draft",
  note: confirmed
    ? "Scores against labels a person confirmed field by field."
    : "DRAFT: scored against draft labels from a second Claude pass (high effort, quoted evidence) with a deterministic cross-check. No label is confirmed by a person yet, so Claude's scores here partly measure agreement between two Claude passes. The baseline and the lint counts do not depend on the labeler.",
  scoredAt: new Date().toISOString(),
  sample: { items: labels.length, photoRefund: labels.filter((l) => l.kind === "photo_refund").length, nonPhoto: labels.filter((l) => l.kind === "non_photo").length },
  fields: SCORED_FIELDS,
  scoring:
    "Exact match per field: booleans and enums equal; actions and must_show as sets; marker_text equal ignoring case, quote marks and spacing (null equals null only); refund_amount equal to the cent (null equals null only). allFieldsCorrect needs all seven. Actions and must_show also get micro precision, recall and F1.",
  summary: table,
  variants: results,
};
writeFileSync(path.join(benchDir, "results.json"), JSON.stringify(out, null, 1));
console.log(`Benchmark (${out.status}): ${labels.length} recalls`);
console.table(table);
