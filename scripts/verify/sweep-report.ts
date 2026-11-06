/**
 * Read content/verify/sweep-results.json and compare each configuration with Claude Opus 5.5 at medium effort, case by
 * case: known-answer accuracy, decision agreement with Opus in the same trial, the spread across trials, cost and time.
 * Free: reads a file, calls nothing.
 *
 *   npx tsx scripts/verify/sweep-report.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Row = { config: string; trial: number; case: string; ok: boolean; decision: string; decided_by: string; C1: number | string; C1_status: string; C2: string; C3: string; usd: number; ms: number; vision_ms: number };
const file = path.join(process.cwd(), "content", "verify", "sweep-results.json");
const data = JSON.parse(readFileSync(file, "utf8")) as { trials: number; stopped: string | null; cases: Row[]; spentUsd: number };
const rows = data.cases;
const configs = [...new Set(rows.map((r) => r.config))];
const cases = [...new Set(rows.map((r) => r.case))];
const BASE = "opus-medium";
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

const summary = configs.map((cfg) => {
  const mine = rows.filter((r) => r.config === cfg);
  const trials = [...new Set(mine.map((r) => r.trial))];
  const perTrial = trials.map((t) => mine.filter((r) => r.trial === t && r.ok).length);
  // Same trial, same case: does this configuration reach the decision Opus medium reached?
  let agree = 0;
  let paired = 0;
  for (const r of mine) {
    const b = rows.find((x) => x.config === BASE && x.trial === r.trial && x.case === r.case);
    if (!b) continue;
    paired++;
    if (b.decision === r.decision) agree++;
  }
  const cases_ = new Set(mine.map((r) => r.case)).size;
  return {
    config: cfg,
    trials: trials.length,
    "known-answer correct per trial": perTrial.map((n) => `${n}/${cases_}`).join(", "),
    "accuracy %": Math.round((mine.filter((r) => r.ok).length / Math.max(1, mine.length)) * 100),
    "same decision as Opus medium": cfg === BASE ? "baseline" : `${agree}/${paired}`,
    "USD per case": Number((mine.reduce((s, r) => s + r.usd, 0) / Math.max(1, mine.length)).toFixed(4)),
    "median s": Number(((median(mine.map((r) => r.ms)) ?? 0) / 1000).toFixed(1)),
  };
});

const perCase = cases.map((c) => {
  const out: Record<string, string> = { case: c };
  for (const cfg of configs) {
    const rs = rows.filter((r) => r.case === c && r.config === cfg).sort((a, b) => a.trial - b.trial);
    out[cfg] = rs.map((r) => `${r.ok ? "ok" : "MISS"} ${r.decision}${typeof r.C1 === "number" ? ` C1 ${r.C1}` : ""}`).join(" | ");
  }
  return out;
});

console.table(summary);
console.table(perCase);
if (data.stopped) console.log(data.stopped);
console.log(`Spent by the sweep run: $${data.spentUsd}`);
writeFileSync(path.join(process.cwd(), "content", "verify", "sweep-report.json"), JSON.stringify({ madeAt: new Date().toISOString(), baseline: BASE, summary, perCase }, null, 1) + "\n");
