// Seeds the sample firm, Brightline Home (fictional, is_sample = true), and a second sample firm, Fernway Home, which
// sells the same sample charger under its own name. Safe to run again: each firm is upserted by its slug. Brightline's
// own fictional sample recall (content/recalls/samples.json, BH-2026-01) and the real CPSC recalls in
// content/recalls/demo-picks.json are linked to Brightline as firm_recall rows, once loaded, so the claim flow and the
// console have recalls to run; Fernway's sample recall (FW-2026-01) is linked to Fernway. Brightline is seeded first,
// so it keeps the lower id the console and the payment store pick.
//
//   npx tsx --env-file=.env.local scripts/seed.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { audit } from "../src/lib/audit";
import { db, dbConfigured, schema } from "../src/lib/db";

export const SAMPLE_FIRM = {
  slug: "brightline-home",
  name: "Brightline Home",
  isSample: true,
  contactEmail: "recalls@brightline-home.example",
  settings: { autoApproveCap: 50, dailyPayoutCap: 350, reviewHours: 48, replyName: "Brightline Home recall team" },
} as const;

/** The second sample firm: its recall shows the earlier-claim check across firms, where only the photo's hash crosses. */
export const SECOND_SAMPLE_FIRM = {
  slug: "fernway-home",
  name: "Fernway Home",
  isSample: true,
  contactEmail: "recalls@fernway-home.example",
  settings: { autoApproveCap: 50, dailyPayoutCap: 200, reviewHours: 48, replyName: "Fernway Home recall team" },
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

/** The fictional sample recalls a firm runs itself, by their two-letter prefix: BH for Brightline, FW for Fernway. */
function sampleNumbers(prefix: "BH" | "FW"): string[] {
  const p = join(process.cwd(), "content", "recalls", "samples.json");
  if (!existsSync(p)) return [];
  return ((JSON.parse(readFileSync(p, "utf8")) as { recalls?: { number: string }[] }).recalls ?? []).map((r) => r.number).filter((n) => n.startsWith(`${prefix}-`));
}

type SeedFirm = { slug: string; name: string; isSample: boolean; contactEmail: string; settings: { autoApproveCap: number; dailyPayoutCap: number; reviewHours: number; replyName: string } };

/** Upserts one sample firm and links the loaded recalls it runs. Returns the firm and how many recalls it runs. */
async function seedFirm(f: SeedFirm, wanted: string[]) {
  const [firm] = await db()
    .insert(schema.firms)
    .values(f)
    .onConflictDoUpdate({ target: schema.firms.slug, set: { name: f.name, isSample: true, contactEmail: f.contactEmail, settings: f.settings } })
    .returning();
  const present = wanted.length ? (await db().select({ n: schema.recalls.number }).from(schema.recalls).where(inArray(schema.recalls.number, wanted))).map((r) => r.n) : [];
  for (const recallNumber of present) {
    await db()
      .insert(schema.firmRecalls)
      .values({ firmId: firm.id, recallNumber, autoCap: String(f.settings.autoApproveCap.toFixed(2)), dailyCap: String(f.settings.dailyPayoutCap.toFixed(2)) })
      .onConflictDoUpdate({ target: [schema.firmRecalls.firmId, schema.firmRecalls.recallNumber], set: { dailyCap: String(f.settings.dailyPayoutCap.toFixed(2)) } });
  }
  const [{ links }] = await db().select({ links: sql<number>`count(*)::int` }).from(schema.firmRecalls).where(sql`${schema.firmRecalls.firmId} = ${firm.id}`);
  await audit("system", "seed.firm", `firm:${firm.id}`, { slug: firm.slug, isSample: firm.isSample, recalls: links });
  return { firm, links, present };
}

async function main() {
  if (!dbConfigured()) {
    console.error("seed: DATABASE_URL is not set. Run with: npx tsx --env-file=.env.local scripts/seed.ts");
    process.exit(1);
  }
  // Brightline's own sample recall (content/recalls/samples.json) first, then the real CPSC demo recalls as extras.
  const wanted = [...new Set([...sampleNumbers("BH"), ...demoNumbers()])];
  const { firm, links, present } = await seedFirm(SAMPLE_FIRM, wanted);
  console.log(`seed: ${firm.name} (id ${firm.id}, is_sample ${firm.isSample}); ${links} recalls linked${wanted.length && present.length < wanted.length ? `; ${wanted.length - present.length} demo picks are not loaded yet (run scripts/load-recalls.ts)` : ""}.`);
  // A recall linked to Brightline by an earlier seed that now belongs to Fernway moves to Fernway.
  const second = await seedFirm(SECOND_SAMPLE_FIRM, sampleNumbers("FW"));
  if (second.present.length) await db().delete(schema.firmRecalls).where(and(eq(schema.firmRecalls.firmId, firm.id), inArray(schema.firmRecalls.recallNumber, second.present)));
  console.log(`seed: ${second.firm.name} (id ${second.firm.id}, is_sample ${second.firm.isSample}); ${second.links} recalls linked.`);
  process.exit(0);
}

// Run only when called as a script, so tests can import SAMPLE_FIRM.
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
