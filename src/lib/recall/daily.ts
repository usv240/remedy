/**
 * The daily recall ingest: every CPSC recall newer than the latest one stored, normalized and classified, with a proof
 * rule read by Claude Opus 5.5 for each new photo-refund recall (direct structured calls with a self-check, inside the
 * site's daily AI budget and this run's own cap), its official images hashed for the own-photo check, the rows written
 * to Postgres (recall, proof_rule, image_hash), the Elastic index refreshed for the new rows, and the run recorded
 * in integration_status for /status. The committed files under content/recalls are never written. Server only.
 */
import { sql } from "drizzle-orm";
import { overBudget, spendSince } from "@/lib/ai/usage";
import { db, dbConfigured, schema } from "@/lib/db";
import { officialHashRows, recallRow } from "@/lib/db/load";
import { fetchAllCpscRecalls, USER_AGENT } from "./cpsc-client";
import { dhash } from "./dhash";
import { normalizeAll } from "./ingest";
import { extractBaseline, extractWithClaude, type ProofRule } from "./proof-rule";
import { loadRecalls, upsertIndex, elasticConfigured } from "./search";
import type { RawCpscRecall, Recall } from "./types";

export const INGEST_STATUS_ID = "recall-ingest";

export type DailyOptions = {
  /** Plan only: fetch and classify, write nothing, call no model. */
  dry?: boolean;
  /** Only recalls dated on or after this day (YYYY-MM-DD). Default: the day of the latest stored recall. */
  since?: string;
  /** Only recalls dated on or before this day. */
  until?: string;
  /** At most this many Claude proof rules in one run; the rest get the deterministic quick read. Default 20. */
  maxRules?: number;
  /** This run's Claude spend cap in US dollars (measured from ai_usage). Default 1. */
  capUsd?: number;
  /** Official images to download and hash per new photo-refund recall. Default 6. */
  imagesPerRecall?: number;
  log?: (s: string) => void;
};

export type DailyResult = {
  dry: boolean;
  since: string;
  fetched: number;
  newRecalls: { number: string; date: string; title: string; photoRefund: boolean; category: string }[];
  rules: { claude: number; baseline: number; skipped: number };
  images: { hashed: number; failed: number };
  elastic: { indexed: number; mode: "elastic" | "not_connected" | "failed" };
  usd: number;
  ms: number;
  note: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The newest recall date in the database, or in the committed file when there is no database. */
export async function latestStoredDate(): Promise<string> {
  const file = loadRecalls()[0]?.date ?? "2024-01-01";
  if (!dbConfigured()) return file;
  try {
    const [row] = await db().select({ max: sql<string | null>`max(${schema.recalls.date})::text` }).from(schema.recalls);
    return row?.max && row.max > file ? row.max : file;
  } catch {
    return file;
  }
}

/** Every recall number already stored: the committed file plus the database. */
async function knownNumbers(): Promise<Set<string>> {
  const known = new Set(loadRecalls().map((r) => r.number));
  if (dbConfigured()) {
    try {
      for (const r of await db().select({ n: schema.recalls.number }).from(schema.recalls)) known.add(r.n);
    } catch {
      /* the file's numbers still apply */
    }
  }
  return known;
}

async function download(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "image/*" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(1500 * attempt);
    }
  }
}

/** Download and hash a recall's official images, a few at a time, politely. */
export async function hashOfficialImages(r: Recall, limit: number, log: (s: string) => void): Promise<{ rows: { url: string; dhash: string }[]; failed: number }> {
  const rows: { url: string; dhash: string }[] = [];
  let failed = 0;
  for (const img of r.images.slice(0, limit)) {
    try {
      const buf = await download(img.url);
      rows.push({ url: img.url, dhash: await dhash(buf) });
      await sleep(250);
    } catch (e) {
      failed++;
      log(`  image ${img.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { rows, failed };
}

/** Postgres refuses NUL characters in text and jsonb; public data occasionally carries one. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\\u0000/g, ""));

async function writeRecall(r: Recall, raw: RawCpscRecall | undefined, rule: { rule: ProofRule; source: "ai" | "baseline"; model: string | null } | null, hashes: { url: string; dhash: string }[]) {
  const out = recallRow(r);
  if (!("row" in out)) throw new Error(out.skip);
  await db()
    .insert(schema.recalls)
    .values({ ...clean(out.row), raw: raw ? clean(raw) : null })
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
        raw: sql`excluded.raw`,
        updatedAt: sql`now()`,
      },
    });
  if (rule) {
    // A new recall has no rule yet; a rerun on the same day keeps whatever is there (a firm's edit above all).
    await db().insert(schema.proofRules).values({ recallNumber: r.number, rule: clean(rule.rule), source: rule.source, model: rule.model, version: 1 }).onConflictDoNothing();
  }
  const hashRows = officialHashRows({ [r.number]: hashes });
  if (hashRows.length) {
    await db()
      .insert(schema.imageHashes)
      .values(hashRows)
      .onConflictDoUpdate({ target: [schema.imageHashes.source, schema.imageHashes.ref], set: { dhash: sql`excluded.dhash`, recallNumber: sql`excluded.recall_number` } });
  }
}

/** Record the run for /status (integration_status, id recall-ingest). Never throws. */
export async function recordRun(o: { ok: boolean; detail: string; ms: number; error?: string }) {
  if (!dbConfigured()) return;
  try {
    const now = new Date();
    await db()
      .insert(schema.integrationStatus)
      .values({ id: INGEST_STATUS_ID, mode: o.ok ? "live" : "fallback", detail: o.detail, lastOkAt: o.ok ? now : null, lastErrorAt: o.ok ? null : now, lastError: o.error ?? null, lastMs: o.ms, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.integrationStatus.id,
        set: o.ok ? { mode: "live", detail: o.detail, lastOkAt: now, lastMs: o.ms, lastError: null, updatedAt: now } : { mode: "fallback", detail: o.detail, lastErrorAt: now, lastError: o.error ?? null, lastMs: o.ms, updatedAt: now },
      });
  } catch (e) {
    console.error(`recall-ingest: could not record the run: ${(e as Error).message}`);
  }
}

/** The last recorded run, for /status. */
export async function lastRun(): Promise<{ mode: string; detail: string; lastOkAt: Date | null; lastErrorAt: Date | null; lastError: string | null; lastMs: number | null } | null> {
  if (!dbConfigured()) return null;
  try {
    const [row] = await db().select().from(schema.integrationStatus).where(sql`${schema.integrationStatus.id} = ${INGEST_STATUS_ID}`).limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Run the daily ingest. Dry runs write nothing and call no model. A real run needs a database; Claude and Elastic
 * are each optional, with the quick read and no indexing as their fallbacks.
 */
export async function runDaily(opts: DailyOptions = {}): Promise<DailyResult> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const dry = Boolean(opts.dry);
  const since = opts.since ?? (await latestStoredDate());
  const maxRules = opts.maxRules ?? 20;
  const cap = opts.capUsd ?? 1;
  const perRecall = opts.imagesPerRecall ?? 6;
  if (!dry && !dbConfigured()) throw new Error("DATABASE_URL is not set, so the daily ingest has nowhere to write. Use --dry to plan.");

  log(`recall-ingest: recalls since ${since}${opts.until ? ` to ${opts.until}` : ""}${dry ? " (dry run)" : ""}`);
  const raw = await fetchAllCpscRecalls(since);
  const known = await knownNumbers();
  const rawBy = new Map(raw.map((r) => [String(r.RecallNumber ?? ""), r]));
  const fresh = normalizeAll(raw).filter((r) => r.number && !known.has(r.number) && r.date >= since && (!opts.until || r.date <= opts.until));
  log(`recall-ingest: ${raw.length} fetched, ${fresh.length} new (${fresh.filter((r) => r.photoRefund).length} photo-refund)`);

  const result: DailyResult = {
    dry,
    since,
    fetched: raw.length,
    newRecalls: fresh.map((r) => ({ number: r.number, date: r.date, title: r.title, photoRefund: r.photoRefund, category: r.category })),
    rules: { claude: 0, baseline: 0, skipped: 0 },
    images: { hashed: 0, failed: 0 },
    elastic: { indexed: 0, mode: elasticConfigured() ? "elastic" : "not_connected" },
    usd: 0,
    ms: 0,
    note: "",
  };
  if (dry || !fresh.length) {
    result.ms = Date.now() - started;
    result.note = dry ? `Dry run: ${fresh.length} new recalls would be stored; nothing was written and no model was called.` : "Nothing new since the last run.";
    if (!dry) await recordRun({ ok: true, detail: `${result.note} Checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`, ms: result.ms });
    return result;
  }

  const runStart = new Date();
  const aiOn = Boolean(process.env.ANTHROPIC_API_KEY);
  const written: Recall[] = [];
  let runUsd = 0;
  try {
    for (const r of fresh) {
      let rule: { rule: ProofRule; source: "ai" | "baseline"; model: string | null } | null = null;
      let hashes: { url: string; dhash: string }[] = [];
      if (r.photoRefund) {
        // Claude, inside the daily budget and this run's cap; otherwise the deterministic quick read, labelled baseline.
        const over = aiOn && (await overBudget().catch(() => ({ over: false }))).over;
        const spent = aiOn ? await spendSince(runStart).catch(() => ({ usd: 0, calls: 0 })) : { usd: 0, calls: 0 };
        runUsd = spent.usd;
        if (aiOn && !over && runUsd < cap && result.rules.claude < maxRules) {
          try {
            const out = await extractWithClaude(r, { selfCheck: true });
            rule = { rule: out.rule, source: "ai", model: out.model };
            result.rules.claude++;
            log(`  ${r.number} rule by ${out.model}: ${out.rule.actions.join(", ") || "no action"}, ${out.rule.remedy}`);
          } catch (e) {
            rule = { rule: extractBaseline(r), source: "baseline", model: null };
            result.rules.baseline++;
            log(`  ${r.number} rule: quick read (${e instanceof Error ? e.message : String(e)})`);
          }
        } else {
          rule = { rule: extractBaseline(r), source: "baseline", model: null };
          result.rules.baseline++;
          if (aiOn && (over || runUsd >= cap || result.rules.claude >= maxRules)) result.rules.skipped++;
          log(`  ${r.number} rule: quick read (${!aiOn ? "no API key" : over ? "daily AI budget used" : runUsd >= cap ? "run cap reached" : "rule limit reached"})`);
        }
        const h = await hashOfficialImages(r, perRecall, log);
        hashes = h.rows;
        result.images.hashed += h.rows.length;
        result.images.failed += h.failed;
      }
      await writeRecall(r, rawBy.get(r.number), rule, hashes);
      written.push(r);
      log(`  stored ${r.number} (${r.date}) ${r.title.slice(0, 80)}`);
    }
    if (elasticConfigured()) {
      try {
        result.elastic.indexed = await upsertIndex(written);
      } catch (e) {
        result.elastic.mode = "failed";
        log(`  elastic: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    result.usd = aiOn ? (await spendSince(runStart).catch(() => ({ usd: runUsd }))).usd : 0;
    result.ms = Date.now() - started;
    result.note = `${written.length} new ${written.length === 1 ? "recall" : "recalls"} stored (${written.filter((r) => r.photoRefund).length} photo-refund), ${result.rules.claude} rules by Claude, ${result.rules.baseline} quick reads, ${result.images.hashed} images hashed, ${result.elastic.indexed} indexed; $${result.usd.toFixed(4)}.`;
    await recordRun({ ok: true, detail: `${result.note} Ran ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`, ms: result.ms });
    return result;
  } catch (e) {
    result.ms = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    result.note = `Stopped after ${written.length} of ${fresh.length} new recalls: ${msg}`;
    await recordRun({ ok: false, detail: result.note, ms: result.ms, error: msg });
    throw e;
  }
}
