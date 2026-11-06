// Loads the recall data into Postgres: content/recalls/recalls.json into `recall`, proof-rules.json into `proof_rule`,
// and image-hashes.json (when present) into `image_hash`. Every step is an upsert, so it can run again after each
// pull or extraction. A file that does not exist yet is skipped with a note, never an error.
//
//   npx tsx --env-file=.env.local scripts/load-recalls.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { audit } from "../src/lib/audit";
import { db, dbConfigured, schema } from "../src/lib/db";
import { chunks, officialHashRows, recallRow, ruleAction, type RecallRow } from "../src/lib/db/load";

const DIR = join(process.cwd(), "content", "recalls");

function readJson(name: string): unknown | null {
  const p = join(DIR, name);
  if (!existsSync(p)) {
    console.log(`load-recalls: content/recalls/${name} is not there yet; skipped.`);
    return null;
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Postgres refuses NUL characters in text and jsonb; public data occasionally carries one. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\\u0000/g, ""));

async function loadRecalls(file: unknown) {
  const list = (file as { recalls?: unknown[] } | null)?.recalls;
  if (!Array.isArray(list)) {
    console.log("load-recalls: recalls.json has no recalls array; skipped.");
    return { loaded: 0, skipped: 0, numbers: new Set<string>() };
  }
  const rows: RecallRow[] = [];
  const skips: string[] = [];
  for (const r of list) {
    const out = recallRow(r);
    if ("row" in out) rows.push(clean(out.row));
    else skips.push(out.skip);
  }
  // The same number twice in one insert would fail the upsert; the last one in the file wins.
  const unique = [...new Map(rows.map((r) => [r.number, r])).values()];
  for (const part of chunks(unique, 200)) {
    await db()
      .insert(schema.recalls)
      .values(part)
      .onConflictDoUpdate({
        target: schema.recalls.number,
        set: {
          title: sql`excluded.title`,
          date: sql`excluded.date`,
          units: sql`excluded.units`,
          unitsText: sql`excluded.units_text`,
          hazard: sql`excluded.hazard`,
          remedyText: sql`excluded.remedy_text`,
          remedies: sql`excluded.remedies`,
          products: sql`excluded.products`,
          images: sql`excluded.images`,
          retailers: sql`excluded.retailers`,
          manufacturers: sql`excluded.manufacturers`,
          consumerContact: sql`excluded.consumer_contact`,
          url: sql`excluded.url`,
          photoRefund: sql`excluded.photo_refund`,
          flags: sql`excluded.flags`,
          updatedAt: sql`now()`,
        },
      });
  }
  if (skips.length) console.log(`load-recalls: skipped ${skips.length} recalls (${skips.slice(0, 3).join("; ")}${skips.length > 3 ? "; ..." : ""}).`);
  return { loaded: unique.length, skipped: skips.length, numbers: new Set(unique.map((r) => r.number)) };
}

async function loadRules(file: unknown) {
  const f = file as { model?: string; rules?: Record<string, unknown> } | null;
  if (!f?.rules || typeof f.rules !== "object") {
    if (file) console.log("load-recalls: proof-rules.json has no rules object; skipped.");
    return { inserted: 0, updated: 0, same: 0, keptFirm: 0, missingRecall: 0 };
  }
  const known = new Set((await db().select({ n: schema.recalls.number }).from(schema.recalls)).map((r) => r.n));
  const counts = { inserted: 0, updated: 0, same: 0, keptFirm: 0, missingRecall: 0 };
  for (const [recallNumber, raw] of Object.entries(f.rules)) {
    if (!known.has(recallNumber)) {
      counts.missingRecall++;
      continue;
    }
    const rule = clean(raw);
    const [latest] = await db()
      .select({ id: schema.proofRules.id, source: schema.proofRules.source, version: schema.proofRules.version, rule: schema.proofRules.rule })
      .from(schema.proofRules)
      .where(eq(schema.proofRules.recallNumber, recallNumber))
      .orderBy(desc(schema.proofRules.version))
      .limit(1);
    const action = ruleAction(latest ?? null, rule);
    if (action === "insert") {
      await db().insert(schema.proofRules).values({ recallNumber, rule, source: "ai", model: f.model ?? null, version: 1 });
      counts.inserted++;
    } else if (action === "update" && latest) {
      await db()
        .update(schema.proofRules)
        .set({ rule, model: f.model ?? null })
        .where(and(eq(schema.proofRules.id, latest.id), eq(schema.proofRules.source, "ai")));
      counts.updated++;
    } else if (action === "same") counts.same++;
    else counts.keptFirm++;
  }
  return counts;
}

async function loadHashes(file: unknown, known: Set<string>) {
  const rows = officialHashRows(file).filter((r) => known.size === 0 || known.has(r.recallNumber));
  for (const part of chunks(rows, 500)) {
    await db()
      .insert(schema.imageHashes)
      .values(part)
      .onConflictDoUpdate({ target: [schema.imageHashes.source, schema.imageHashes.ref], set: { dhash: sql`excluded.dhash`, recallNumber: sql`excluded.recall_number` } });
  }
  return rows.length;
}

async function main() {
  if (!dbConfigured()) {
    console.error("load-recalls: DATABASE_URL is not set. Run with: npx tsx --env-file=.env.local scripts/load-recalls.ts");
    process.exit(1);
  }
  const started = Date.now();
  const recalls = await loadRecalls(readJson("recalls.json"));
  const rules = await loadRules(readJson("proof-rules.json"));
  const hashes = await loadHashes(readJson("image-hashes.json"), recalls.numbers);
  const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.recalls);
  const summary = { recallsInFile: recalls.loaded, recallsSkipped: recalls.skipped, recallsInDatabase: n, rules, officialHashes: hashes, ms: Date.now() - started };
  console.log(`load-recalls: ${JSON.stringify(summary)}`);
  if (recalls.loaded || rules.inserted || rules.updated || hashes) await audit("system", "recalls.loaded", "content/recalls", summary);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
