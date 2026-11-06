// Seeds the sample firm, Brightline Home (fictional, is_sample = true). Safe to run again: the firm is upserted by its
// slug. When the recalls are loaded and content/recalls/demo-picks.json names the demo recalls, each one is linked
// to the firm as a firm_recall, so the claim flow and the console have a recall to run.
//
//   npx tsx --env-file=.env.local scripts/seed.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inArray, sql } from "drizzle-orm";
import { audit } from "../src/lib/audit";
import { db, dbConfigured, schema } from "../src/lib/db";

export const SAMPLE_FIRM = {
  slug: "brightline-home",
  name: "Brightline Home",
  isSample: true,
  contactEmail: "recalls@brightline-home.example",
  settings: { autoApproveCap: 50, dailyPayoutCap: 2500, reviewHours: 48, replyName: "Brightline Home recall team" },
} as const;

/** Recall numbers from demo-picks.json, whatever its exact shape: a list, { picks: [...] }, or an object keyed by id. */
function demoNumbers(): string[] {
  const p = join(process.cwd(), "content", "recalls", "demo-picks.json");
  if (!existsSync(p)) return [];
  const j = JSON.parse(readFileSync(p, "utf8")) as unknown;
  const list = Array.isArray(j) ? j : j && typeof j === "object" ? (Array.isArray((j as { picks?: unknown[] }).picks) ? (j as { picks: unknown[] }).picks : Object.values(j)) : [];
  const nums = list.map((x) => (x && typeof x === "object" ? String((x as Record<string, unknown>).number ?? (x as Record<string, unknown>).recallNumber ?? "") : "")).filter(Boolean);
  return [...new Set(nums)];
}

async function main() {
  if (!dbConfigured()) {
    console.error("seed: DATABASE_URL is not set. Run with: npx tsx --env-file=.env.local scripts/seed.ts");
    process.exit(1);
  }
  const [firm] = await db()
    .insert(schema.firms)
    .values(SAMPLE_FIRM)
    .onConflictDoUpdate({ target: schema.firms.slug, set: { name: SAMPLE_FIRM.name, isSample: true, contactEmail: SAMPLE_FIRM.contactEmail, settings: SAMPLE_FIRM.settings } })
    .returning();

  const wanted = demoNumbers();
  const present = wanted.length ? (await db().select({ n: schema.recalls.number }).from(schema.recalls).where(inArray(schema.recalls.number, wanted))).map((r) => r.n) : [];
  for (const recallNumber of present) {
    await db()
      .insert(schema.firmRecalls)
      .values({ firmId: firm.id, recallNumber, autoCap: String(SAMPLE_FIRM.settings.autoApproveCap.toFixed(2)), dailyCap: String(SAMPLE_FIRM.settings.dailyPayoutCap.toFixed(2)) })
      .onConflictDoNothing({ target: [schema.firmRecalls.firmId, schema.firmRecalls.recallNumber] });
  }
  const [{ links }] = await db().select({ links: sql<number>`count(*)::int` }).from(schema.firmRecalls).where(sql`${schema.firmRecalls.firmId} = ${firm.id}`);
  await audit("system", "seed.firm", `firm:${firm.id}`, { slug: firm.slug, isSample: firm.isSample, recalls: links });
  console.log(`seed: ${firm.name} (id ${firm.id}, is_sample ${firm.isSample}); ${links} recalls linked${wanted.length && present.length < wanted.length ? `; ${wanted.length - present.length} demo picks are not loaded yet (run scripts/load-recalls.ts)` : ""}.`);
  process.exit(0);
}

// Run only when called as a script, so tests can import SAMPLE_FIRM.
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
