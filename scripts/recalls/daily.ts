/**
 * The daily recall ingest, from the command line (Render runs the same job through POST /api/ops/recalls/daily).
 *
 *   npx tsx --env-file=.env.local scripts/recalls/daily.ts [--dry] [--since 2026-11-06] [--until 2026-11-06]
 *                                                        [--max-rules 20] [--cap-usd 1] [--images 6]
 *
 * Pulls every CPSC recall newer than the latest one stored, classifies it, reads a proof rule with Claude Opus 5.5
 * for each new photo-refund recall (inside the daily AI budget and --cap-usd), hashes its official images, writes the
 * rows to Postgres and refreshes the Elastic index. --dry plans only: nothing is written and no model is called.
 * The committed files under content/recalls are never touched.
 */
import { runDaily } from "../../src/lib/recall/daily";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const num = (v: string | undefined) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined);

async function main() {
  const r = await runDaily({
    dry: process.argv.includes("--dry"),
    since: arg("since"),
    until: arg("until"),
    maxRules: num(arg("max-rules")),
    capUsd: num(arg("cap-usd")),
    imagesPerRecall: num(arg("images")),
    log: (s) => console.log(s),
  });
  console.log(JSON.stringify({ ...r, newRecalls: r.newRecalls.length, list: r.newRecalls.map((x) => `${x.number} ${x.date} ${x.photoRefund ? "photo-refund " : ""}${x.title.slice(0, 70)}`) }, null, 1));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
