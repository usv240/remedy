/**
 * The photo eval for the label check: Claude reads each real label photo in content/label/photo-eval-cases.json (written,
 * with each expected answer, before any run), code finds the recall, and the answer is scored against the file.
 *
 *   npx tsx --env-file=.env.local scripts/label/eval-photos.ts                          plan and estimated cost, free
 *   npx tsx --env-file=.env.local scripts/label/eval-photos.ts --run --yes --max-usd 1  reads and scores, within the cap
 *   add --only <case id> for one case
 *
 * Each image is downloaded from its source and its SHA-256 checked against the file, so the run reads the very picture
 * that was looked at. The run stops before a reading would take spend past --max-usd (estimated per image from its
 * size, then counted from what each call cost). Writes content/label/photo-eval-results.json. Without --run it calls no
 * model and opens no network connection.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkReading } from "../../src/lib/label/check";
import { readLabelLive, sha256 } from "../../src/lib/label/read";
import { codeOf, gtin } from "../../src/lib/recall/codes";
import { LABEL_MAX_SIDE, visualTokens } from "../../src/lib/verify/image";

type Case = {
  id: string;
  url: string;
  sha256: string;
  width: number;
  height: number;
  expect: { outcome: "match" | "no_recall"; recall: string | null; code: string | null };
  looked_at: { model: string | null; upc: string | null };
  credit: string;
};
type CasesFile = { note: string; written_at: string; scoring: string; cases: Case[] };

const ROOT = process.cwd();
const CASES = path.join(ROOT, "content", "label", "photo-eval-cases.json");
const OUT = path.join(ROOT, "content", "label", "photo-eval-results.json");

/** Tokens a label reading costs besides the image (instructions and the output schema), measured on the recorded samples. */
export const OVERHEAD_TOKENS = 2450;
/** Output tokens a reading takes, rounded up from the recorded samples (295 to 420). */
export const OUTPUT_TOKENS = 500;

/** The image as sent: fit inside LABEL_MAX_SIDE, never enlarged. */
export const sentSize = (w: number, h: number) => {
  const k = Math.min(1, LABEL_MAX_SIDE / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)] as const;
};
/** US dollars for one reading at Opus 5.5 rates, the prompt priced as a cache write ($5 per million), as the recorded samples were billed. */
export const estimateUsd = (c: Pick<Case, "width" | "height">) => {
  const [w, h] = sentSize(c.width, c.height);
  return ((OVERHEAD_TOKENS + visualTokens(w, h)) * 5 + OUTPUT_TOKENS * 20) / 1e6;
};

export function plan(file: CasesFile = JSON.parse(readFileSync(CASES, "utf8")) as CasesFile) {
  const rows = file.cases.map((c) => ({ id: c.id, expect: c.expect.recall ?? "no recall", est_usd: Number(estimateUsd(c).toFixed(4)) }));
  const total = rows.reduce((s, r) => s + r.est_usd, 0);
  return { rows, total: Math.round(total * 100) / 100, cases: rows.length };
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const file = JSON.parse(readFileSync(CASES, "utf8")) as CasesFile;
  const only = arg("--only");
  const cases = file.cases.filter((c) => !only || c.id === only);
  const p = plan({ ...file, cases });
  if (!(process.argv.includes("--run") && process.argv.includes("--yes"))) {
    console.table(p.rows);
    console.log(`${p.cases} cases, estimated $${p.total.toFixed(2)} at most (one Claude Opus 5.5 reading each, effort low). Plan only: add --run --yes --max-usd <cap> to run.`);
    return;
  }
  const cap = Number(arg("--max-usd"));
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Give a spend cap: --max-usd 1");
  let spent = 0;
  const results: Record<string, unknown>[] = [];
  let stopped: string | null = null;
  for (const c of cases) {
    if (spent + estimateUsd(c) > cap) {
      stopped = `Stopped before ${c.id}: its reading would take spend past the $${cap} cap.`;
      break;
    }
    const res = await fetch(c.url, { headers: { "User-Agent": "Mozilla/5.0 (Remedy label eval)" }, signal: AbortSignal.timeout(20_000) });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok || sha256(bytes) !== c.sha256) {
      results.push({ id: c.id, skipped: `The image at its source is not the one looked at (HTTP ${res.status}, SHA-256 differs).` });
      continue;
    }
    const run = await readLabelLive(bytes);
    spent += run.cost_usd;
    const check = await checkReading(run.reading);
    const byCode = check.matches.filter((m) => m.matched_by !== "keywords").map((m) => m.number);
    const shown = check.matches.map((m) => m.number);
    const right = c.expect.recall ? byCode.includes(c.expect.recall) : check.outcome !== "match";
    const readCodes = [...run.reading.model_numbers.map((m) => codeOf(m.value)), gtin(run.reading.upc.value) ?? ""].filter(Boolean);
    const want = c.expect.code ? (/^\d{8,}$/.test(c.expect.code) ? gtin(c.expect.code) : codeOf(c.expect.code)) : null;
    results.push({
      id: c.id,
      expect: c.expect,
      outcome: check.outcome,
      matches: check.matches.map((m) => ({ number: m.number, matched_by: m.matched_by, code: m.code })),
      right,
      shown: c.expect.recall ? shown.includes(c.expect.recall) : null,
      code_read_exactly: want ? readCodes.includes(want) : null,
      read: { brand: run.reading.brand.value, models: run.reading.model_numbers.map((m) => m.value), upc: run.reading.upc.value },
      usd: Math.round(run.cost_usd * 10000) / 10000,
      ms: run.ms,
      model: run.model,
    });
    console.log(`${c.id}: ${check.outcome}${right ? " (right)" : " (wrong)"}, $${run.cost_usd.toFixed(4)}`);
  }
  const done = results.filter((r) => !r.skipped);
  const pos = done.filter((r) => (r.expect as Case["expect"]).recall);
  const neg = done.filter((r) => !(r.expect as Case["expect"]).recall);
  const out = {
    note: "The label check on real label photos: Claude read each, code found the recall. Cases and expected answers in content/label/photo-eval-cases.json, written before this run.",
    ran_at: new Date().toISOString(),
    cases_written_at: file.written_at,
    spent_usd: Math.round(spent * 10000) / 10000,
    cap_usd: cap,
    stopped,
    totals: {
      recalled: { n: pos.length, right: pos.filter((r) => r.right).length, shown: pos.filter((r) => r.shown).length, code_read_exactly: pos.filter((r) => r.code_read_exactly).length },
      not_recalled: { n: neg.length, matched_no_recall: neg.filter((r) => r.right).length },
      skipped: results.length - done.length,
    },
    results,
  };
  if (!only) writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out.totals), `spent $${out.spent_usd}`);
}

if (process.argv[1] && /eval-photos\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
