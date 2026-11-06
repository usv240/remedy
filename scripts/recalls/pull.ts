/**
 * Pull every CPSC recall since 2024-01-01 and write content/recalls/recalls.json.
 *
 *   npx tsx scripts/recalls/pull.ts [--start 2024-01-01] [--offline]
 *
 * The raw API response is cached as content/recalls/raw/cpsc-recalls.json (about 4 MB, kept in git; the folder is
 * gitignored only if a pull ever passes 20 MB). --offline re-normalizes the cached file without a network call.
 * content/recalls/raw/cpsc-recalls-2026-11-01.json is the snapshot behind research/validation_recalls.md.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchAllCpscRecalls } from "../../src/lib/recall/cpsc-client";
import { recallsFile } from "../../src/lib/recall/ingest";
import type { RawCpscRecall } from "../../src/lib/recall/types";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const start = arg("start") ?? "2024-01-01";
const offline = process.argv.includes("--offline");
const dir = path.join(process.cwd(), "content", "recalls");
const rawPath = path.join(dir, "raw", "cpsc-recalls.json");

async function main() {
  mkdirSync(path.dirname(rawPath), { recursive: true });
  let raw: RawCpscRecall[];
  let pulledAt: string;
  if (offline) {
    raw = JSON.parse(readFileSync(rawPath, "utf8"));
    pulledAt = statSync(rawPath).mtime.toISOString();
  } else {
    const t = Date.now();
    raw = await fetchAllCpscRecalls(start);
    pulledAt = new Date().toISOString();
    writeFileSync(rawPath, JSON.stringify(raw));
    console.log(`Pulled ${raw.length} records in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  const mb = statSync(rawPath).size / 1e6;
  if (mb > 20) {
    writeFileSync(path.join(dir, "raw", ".gitignore"), "cpsc-recalls.json\n");
    console.log(`Raw cache is ${mb.toFixed(1)} MB, over 20 MB: gitignored.`);
  }
  const file = recallsFile(raw, start, pulledAt);
  writeFileSync(path.join(dir, "recalls.json"), JSON.stringify(file, null, 1));
  const pr = file.recalls.filter((r) => r.photoRefund).length;
  console.log(`recalls.json: ${file.count} recalls, ${file.range.from} to ${file.range.to}; ${pr} photo-refund; raw cache ${mb.toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
