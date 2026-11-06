/**
 * Draw the proof-rule benchmark sample: 100 photo-refund remedies and 30 non-photo remedies, stratified and seeded.
 *
 *   npx tsx scripts/recalls/sample.ts
 *
 * Writes content/recalls/benchmark/sample.json. The same recalls.json and seed always give the same sample.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BENCH_SEED, benchmarkSample } from "../../src/lib/recall/sample";
import type { RecallsFile } from "../../src/lib/recall/types";

const dir = path.join(process.cwd(), "content", "recalls");
const file = JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as RecallsFile;
const { photo, other } = benchmarkSample(file.recalls, BENCH_SEED);
const item = (kind: "photo_refund" | "non_photo") => (r: RecallsFile["recalls"][number]) => ({
  number: r.number,
  kind,
  date: r.date,
  title: r.title,
  remedyText: r.remedyText,
  consumerContact: r.consumerContact,
});
const out = {
  createdAt: new Date().toISOString(),
  recallsPulledAt: file.pulledAt,
  seed: BENCH_SEED,
  method:
    "Seeded (mulberry32) stratified random sample with proportional allocation (largest remainder, at least one per stratum). Photo-refund recalls (flags.photo and flags.refund) are stratified by year and proof kind (marker, else cut, else other). Non-photo recalls (no photo, picture or image in the remedy) are stratified by year and remedy option (refund, else replace, else repair, else other).",
  strata: {
    photoRefund: { sizes: photo.sizes, allocation: photo.allocation },
    nonPhoto: { sizes: other.sizes, allocation: other.allocation },
  },
  items: [...photo.picked.map(item("photo_refund")), ...other.picked.map(item("non_photo"))],
};
mkdirSync(path.join(dir, "benchmark"), { recursive: true });
writeFileSync(path.join(dir, "benchmark", "sample.json"), JSON.stringify(out, null, 1));
console.log(`sample.json: ${photo.picked.length} photo-refund + ${other.picked.length} non-photo`);
console.log("photo-refund allocation", photo.allocation);
console.log("non-photo allocation", other.allocation);
