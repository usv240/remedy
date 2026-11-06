/**
 * Precompute the verification answers for every demo preset (cost free win B), so judges pressing a preset cost $0:
 * the answers go to the verify_result table marked "precomputed", and verifyPhoto reads them like any cache entry.
 * Every check that depends on the claim still runs in code each time.
 *
 *   npx tsx --env-file=.env.local scripts/verify/precompute.ts                 list presets and the expected cost, free
 *   npx tsx --env-file=.env.local scripts/verify/precompute.ts --run --yes     one live run per preset that needs Claude
 *
 * Presets come from content/presets/index.json, plus the team's own photos in content/verify/fixtures/user/expected.json.
 * Recalls and proof rules are the stored ones (content/recalls), so the keys match what the live claim path computes.
 * A preset decided before any model call (official image, blur) needs nothing. A preset already in the table is skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { costUsd } from "../../src/lib/ai/usage";
import { dbConfigured } from "../../src/lib/db";
import { verifyPhoto } from "../../src/lib/verify";
import { cacheKey, dbVerifyCache, engineVersion, photoSha256, ruleVersion } from "../../src/lib/verify/cache";
import { FIXTURES_DIR, loadFixtureRecalls } from "../../src/lib/verify/fixtures";
import type { VerifyProofRule, VerifyRecall } from "../../src/lib/verify/types";

const run = process.argv.includes("--run");
const yes = process.argv.includes("--yes");
const root = process.cwd();
const read = <T>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;

type Preset = { id: string; recall: string; photo: string; options?: Record<string, unknown> };

function presets(): Preset[] {
  const out: Preset[] = [];
  const idx = path.join(root, "content", "presets", "index.json");
  if (existsSync(idx)) {
    for (const p of read<{ presets: (Preset & { technical?: { options?: Record<string, unknown> } })[] }>(idx).presets) {
      out.push({ id: p.id, recall: p.recall, photo: p.photo, options: p.options });
      if (p.technical?.options) out.push({ id: `${p.id} (technical)`, recall: p.recall, photo: p.photo, options: p.technical.options });
    }
  }
  const user = path.join(FIXTURES_DIR, "user", "expected.json");
  if (existsSync(user)) {
    for (const [name, e] of Object.entries(read<Record<string, { recall: string }>>(user))) {
      if (existsSync(path.join(FIXTURES_DIR, "user", name))) out.push({ id: `user/${name}`, recall: e.recall, photo: `user/${name}` });
    }
  }
  return out;
}

/** The recall and rule as the claim path loads them, with official image bytes from the fixtures when on disk. */
function recallFor(num: string): { recall: VerifyRecall; rule: VerifyProofRule } {
  const all = read<{ recalls: (VerifyRecall & { products: { name: string; model: string; type: string; unitsText?: string }[] })[] }>(path.join(root, "content", "recalls", "recalls.json")).recalls;
  const rules = read<{ rules: Record<string, VerifyProofRule> }>(path.join(root, "content", "recalls", "proof-rules.json")).rules;
  const r = all.find((x) => x.number === num);
  const rule = rules[num];
  if (!r || !rule) throw new Error(`Recall ${num} or its proof rule is not in content/recalls.`);
  const onDisk = new Map((loadFixtureRecalls()[num]?.recall.images ?? []).map((i) => [i.url, i.data]));
  return { recall: { ...r, images: r.images.map((i) => ({ ...i, data: onDisk.get(i.url) })) }, rule };
}

(async () => {
  if (!dbConfigured()) throw new Error("DATABASE_URL is not set: the precomputed answers live in the verify_result table.");
  const list = presets();
  const plan: { p: Preset; needs: boolean; cached: boolean; usd: number }[] = [];
  for (const p of list) {
    const { recall, rule } = recallFor(p.recall);
    const photo = readFileSync(path.join(FIXTURES_DIR, p.photo));
    const opts = p.options as { effort?: "low" | "medium" | "high" } | undefined;
    const key = cacheKey({ photoSha256: photoSha256(photo), recallNumber: recall.number, ruleVersion: ruleVersion(rule), engineVersion: engineVersion(undefined, opts?.effort) });
    const cached = Boolean(await dbVerifyCache.get(key));
    // A dry run with no AI shows whether this preset needs Claude at all.
    const dry = await verifyPhoto({ photo, recall, proofRule: rule, options: { ...(p.options ?? {}), cache: false } }, { aiAvailable: () => false, cache: null });
    const needs = Object.values(dry.checks).some((c) => c.status === "unavailable");
    // Measured Opus 5.5 vision calls cost $0.022 to $0.038 (ai_usage, 2026-11-05); a firm review adds two reviewers.
    const usd = needs && !cached ? costUsd("claude-opus-5-5", { input_tokens: 1700, cache_creation_input_tokens: 900, cache_read_input_tokens: 3400, output_tokens: 1000 }) * (dry.decision === "firm_review" ? 3 : 1) : 0;
    plan.push({ p, needs, cached, usd });
  }
  console.table(plan.map((x) => ({ preset: x.p.id, recall: x.p.recall, "needs Claude": x.needs, "already stored": x.cached, "expected USD": Number(x.usd.toFixed(3)) })));
  const total = plan.reduce((s, x) => s + x.usd, 0);
  console.log(`Expected cost: about $${total.toFixed(2)} (upper estimate: assumes a firm review runs both reviewers wherever one could).`);
  if (!run) return console.log("Nothing was spent. Rerun with --run --yes after approval.");
  if (!yes) throw new Error(`This spends about $${total.toFixed(2)}. Add --yes once the spend is approved.`);
  for (const x of plan.filter((y) => y.needs && !y.cached)) {
    const { recall, rule } = recallFor(x.p.recall);
    const r = await verifyPhoto({ photo: readFileSync(path.join(FIXTURES_DIR, x.p.photo)), recall, proofRule: rule, options: { ...(x.p.options ?? {}), cacheSource: "precomputed" } }, { cache: dbVerifyCache });
    console.log(`${x.p.id}: ${r.decision} (${r.decided_by}); stored ${r.cache.stored}; ${r.timings.total_ms} ms`);
  }
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
