/**
 * Records Claude's reading of each sample label once (src/lib/label/samples.ts), so the samples replay, labelled
 * Recorded, with no key and no model call. Writes content/label/recorded/<id>.json.
 *
 *   npx tsx --env-file=.env.local scripts/label/record-samples.ts                 plan and estimated cost, free
 *   npx tsx --env-file=.env.local scripts/label/record-samples.ts --run --yes     records what is missing or changed
 *   add --only <id> for one sample, --rerecord to record again, --cap-usd 0.15 to stop before the cap (default 0.15)
 *
 * A recording is kept while its sample file's SHA-256 is the same; a changed file needs a new one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LABEL_SAMPLES } from "../../src/lib/label/samples";
import { readLabelLive, recordedReading, sha256, type RecordedReading } from "../../src/lib/label/read";
import { decodeImage, LABEL_MAX_SIDE, visualTokens } from "../../src/lib/verify/image";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const run = process.argv.includes("--run") && process.argv.includes("--yes");
const rerecord = process.argv.includes("--rerecord");
const only = arg("--only");
const cap = Number(arg("--cap-usd") ?? 0.15);
const OUT = path.join(process.cwd(), "content", "label", "recorded");

/** A rough ceiling per reading: the image's visual tokens plus about 900 for the instructions, and up to 1,500 out, at Opus 5.5 rates. */
export const estimateUsd = (tokens: number) => ((tokens + 900) * 4 + 1500 * 20) / 1e6;

(async () => {
  let spent = 0;
  const rows: Record<string, unknown>[] = [];
  for (const s of LABEL_SAMPLES.filter((x) => !only || x.id === only)) {
    const file = path.join(process.cwd(), "public", s.src.replace(/^\//, ""));
    const bytes = readFileSync(file);
    const hash = sha256(bytes);
    const img = await decodeImage(bytes, LABEL_MAX_SIDE);
    const meta = await import("sharp").then((m) => m.default(img.jpeg).metadata());
    const tokens = visualTokens(meta.width ?? 0, meta.height ?? 0);
    const have = recordedReading(s.id);
    const fresh = have && have.sha256 === hash && !rerecord;
    const row: Record<string, unknown> = { sample: s.id, size: `${meta.width}x${meta.height}`, image_tokens: tokens, est_usd: Number(estimateUsd(tokens).toFixed(4)), recorded: fresh ? have.recorded_at : "missing" };
    if (fresh || !run) {
      rows.push(row);
      continue;
    }
    if (spent + estimateUsd(tokens) > cap) {
      rows.push({ ...row, recorded: `skipped: the cap of $${cap} would be passed` });
      continue;
    }
    const r = await readLabelLive(bytes);
    spent += r.cost_usd;
    const rec: RecordedReading = { sample: s.id, file: s.src, sha256: hash, recorded_at: new Date().toISOString(), model: r.model, effort: "low", ms: r.ms, usage: r.usage, cost_usd: Math.round(r.cost_usd * 10000) / 10000, reading: r.reading };
    if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `${s.id}.json`), JSON.stringify(rec, null, 2) + "\n");
    rows.push({ ...row, recorded: rec.recorded_at, usd: rec.cost_usd, ms: rec.ms, models: r.reading.model_numbers.map((m) => m.value).join(", "), upc: r.reading.upc.value });
  }
  console.table(rows);
  console.log(run ? `Spent about $${spent.toFixed(4)} (cap $${cap}).` : "Plan only. Add --run --yes to record what is missing.");
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
