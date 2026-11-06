// Run or record a /try preset, from the repo root. `record` makes live Claude calls (about $0.05 each); `run` replays.
//   npx tsx --env-file=.env.local src/app/api/try/_lib/presets-cli.ts run <id> [--technical]
//   npx tsx --env-file=.env.local src/app/api/try/_lib/presets-cli.ts record <id> [--technical]
import { getPreset, recordPreset, runPreset } from "./presets";

async function main() {
  const [cmd, id] = process.argv.slice(2);
  const technical = process.argv.includes("--technical");
  const p = id ? getPreset(id) : null;
  if (!p || (cmd !== "run" && cmd !== "record")) {
    console.error("usage: presets-cli.ts run|record <preset id> [--technical]");
    process.exit(1);
  }
  if (cmd === "record") {
    const r = await recordPreset(p, { technical });
    console.log(JSON.stringify({ decision: r.decision, decided_by: r.decided_by, cost_usd: r.cost_usd, vision: r.vision ? { model: r.vision.model, ms: r.vision.ms, usage: r.vision.usage } : null, reviews: r.reviews?.decision ?? null }, null, 2));
  } else {
    const r = await runPreset(p, { technical });
    const checks = r.result.checks.map((c) => `${c.id}:${c.status}${c.score !== null ? `:${c.score}` : ""}`);
    console.log(JSON.stringify({ decision: r.result.decision, decided_by: r.result.decided_by, summary: r.result.summary?.plain, checks, replay: r.replay, timings: r.result.timings }, null, 2));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
