/**
 * Record what the second-tier agency lookup answers for the check queries, for the docs and tests/e2e/public.mjs.
 *
 *   npx tsx --env-file=.env.local scripts/recalls/agencies.ts
 *
 * Writes content/recalls/agency-check.json: per query, which agencies answered, their hits as the API returns them,
 * and how long each took. Live calls to openFDA and NHTSA; no model call.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { agencyTier } from "../../src/lib/recall/agencies";
import { searchRecalls } from "../../src/lib/recall/search";

export const AGENCY_QUERIES = ["infant formula", "airbag", "Honda Civic 2018", "eye drops", "power bank"];

async function main() {
  const out: Record<string, unknown> = {};
  for (const q of AGENCY_QUERIES) {
    const cpsc = await searchRecalls(q, { k: 3 });
    const tier = await agencyTier(q, cpsc);
    out[q] = { cpsc: { mode: cpsc.mode, top: cpsc.hits.slice(0, 3).map((h) => ({ number: h.number, title: h.title.slice(0, 80), score: h.score })) }, ...tier };
    console.log(`"${q}": CPSC ${cpsc.mode} ${cpsc.hits.length} hits; agencies ${tier.checked ? `${tier.agencies.join(", ") || "none"} (${tier.hits.length} hits, ${tier.ms} ms)` : "not asked"}`);
    for (const h of tier.hits) console.log(`  ${h.agency} ${h.date} ${h.title.slice(0, 90)}`);
  }
  writeFileSync(path.join(process.cwd(), "content", "recalls", "agency-check.json"), JSON.stringify({ checkedAt: new Date().toISOString(), note: "Recorded by scripts/recalls/agencies.ts: the second-tier FDA and NHTSA lookup for each check query, live. Remedy automates photo refunds for CPSC recalls only.", queries: out }, null, 1));
  console.log("wrote content/recalls/agency-check.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
