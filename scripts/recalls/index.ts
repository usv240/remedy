/**
 * Build the Elastic recall index `remedy-recalls` from content/recalls/recalls.json, then run the check queries.
 *
 *   npx tsx --env-file=.env.local scripts/recalls/index.ts [--query-only]
 *
 * Uses ELASTIC_URL and ELASTIC_API_KEY. Without them, it prints the
 * in-app BM25 results instead. Writes content/recalls/search-check.json with the top results per query.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildIndex, elasticConfigured, localSearch, searchRecalls } from "../../src/lib/recall/search";
import type { RecallsFile } from "../../src/lib/recall/types";

export const CHECK_QUERIES = ["space heater", "power bank", "pajamas", "nursing pillow", "baby lounger", "bed rail", "dresser that tips over", "phone charger that overheats"];

async function main() {
  const dir = path.join(process.cwd(), "content", "recalls");
  const file = JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as RecallsFile;
  if (elasticConfigured() && !process.argv.includes("--query-only")) {
    const t = Date.now();
    const res = await buildIndex(file.recalls, (s) => console.log(s));
    console.log(`Indexed ${res.docs} recalls in ${((Date.now() - t) / 1000).toFixed(0)} s (semantic: ${res.model ?? "none"})`);
  } else if (!elasticConfigured()) {
    console.log("Elastic is not connected; showing the in-app BM25.");
  }
  const out: Record<string, unknown> = {};
  for (const q of CHECK_QUERIES) {
    const t = Date.now();
    const r = await searchRecalls(q, { k: 5 });
    const local = localSearch(q, { k: 5, recalls: file.recalls });
    const photo = await searchRecalls(q, { k: 3, filters: { photoRefund: true } });
    out[q] = {
      mode: r.mode,
      model: r.model,
      reranker: r.reranker,
      ms: Date.now() - t,
      top: r.hits.map((h) => ({ number: h.number, title: h.title, photoRefund: h.photoRefund, score: h.score })),
      photoRefundOnly: photo.hits.map((h) => ({ number: h.number, title: h.title })),
      localTop: local.map((h) => ({ number: h.number, title: h.title })),
    };
    console.log(`\n"${q}" (${r.mode}${r.reranker ? " + rerank" : ""}, ${Date.now() - t} ms)`);
    for (const h of r.hits.slice(0, 3)) console.log(`  ${h.number}  ${h.title.slice(0, 100)}`);
  }
  writeFileSync(path.join(dir, "search-check.json"), JSON.stringify({ checkedAt: new Date().toISOString(), elastic: elasticConfigured(), queries: out }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
