import { and, gte, sql } from "drizzle-orm";
import { db, dbConfigured, schema } from "@/lib/db";
import { log } from "@/lib/log";

/**
 * AI spend: what each live Claude call cost, logged per call, and a daily budget that caps the hosted site.
 * There is no Admin API key, so this log is the measurement channel (plan: cost optimization, free win F).
 *
 * Rates per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing.md (fetched 2026-11-05).
 * Cache writes use the 5-minute rate, the only TTL Remedy uses. Batches are half of every rate, cache included.
 * Haiku 5.5 rates are for prompts up to 100,000 tokens; longer prompts use the higher row.
 */

type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const RATES: Record<string, Rate & { long?: Rate & { over: number } }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, long: { over: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
};

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

const n = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** US dollars for one call. Unknown models are priced as Opus 5.5, the most expensive model Remedy uses. */
export function costUsd(model: string, usage: Usage | null | undefined, opts: { batch?: boolean } = {}): number {
  if (!usage) return 0;
  const base = RATES[Object.keys(RATES).find((k) => model.startsWith(k)) ?? "claude-opus-5-5"];
  const prompt = n(usage.input_tokens) + n(usage.cache_read_input_tokens) + n(usage.cache_creation_input_tokens);
  const r = base.long && prompt > base.long.over ? base.long : base;
  const usd = (n(usage.input_tokens) * r.input + n(usage.output_tokens) * r.output + n(usage.cache_read_input_tokens) * r.cacheRead + n(usage.cache_creation_input_tokens) * r.cacheWrite) / 1e6;
  return opts.batch ? usd / 2 : usd;
}

// Without a database (tests, a bare local run) the day's spend is kept in memory for this process.
let memory = { day: "", usd: 0 };
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Record one live call. Never throws: a logging problem must not fail a claim. */
export async function logUsage(e: { route: string; model: string; effort?: string | null; batch?: boolean; usage: Usage | null | undefined }): Promise<number> {
  const usd = costUsd(e.model, e.usage, { batch: e.batch });
  const today = utcDay();
  if (memory.day !== today) memory = { day: today, usd: 0 };
  memory.usd += usd;
  if (!dbConfigured()) return usd;
  try {
    await db()
      .insert(schema.aiUsage)
      .values({
        route: e.route,
        model: e.model,
        effort: e.effort ?? null,
        batch: Boolean(e.batch),
        inputTokens: n(e.usage?.input_tokens),
        outputTokens: n(e.usage?.output_tokens),
        cacheReadInputTokens: n(e.usage?.cache_read_input_tokens),
        cacheCreationInputTokens: n(e.usage?.cache_creation_input_tokens),
        usd: usd.toFixed(6),
      });
  } catch (err) {
    log.error("ai_usage: could not log a call", { route: e.route, error: err });
  }
  return usd;
}

/** Spend so far today (UTC), from the log when there is a database, else from this process. */
export async function spendToday(): Promise<{ usd: number; calls: number; source: "db" | "memory" }> {
  const today = utcDay();
  if (dbConfigured()) {
    try {
      const start = new Date(`${today}T00:00:00.000Z`);
      const [row] = await db()
        .select({ usd: sql<string>`coalesce(sum(${schema.aiUsage.usd}), 0)`, calls: sql<number>`count(*)::int` })
        .from(schema.aiUsage)
        .where(and(gte(schema.aiUsage.at, start)));
      return { usd: Number(row?.usd ?? 0), calls: Number(row?.calls ?? 0), source: "db" };
    } catch {
      /* fall back to this process's count */
    }
  }
  return { usd: memory.day === today ? memory.usd : 0, calls: 0, source: "memory" };
}

/**
 * Spend logged since a moment, from the ai_usage table: the shared meter for an approved measurement budget, so a cap
 * holds across several scripts and across a rerun. Throws without a database, since a cap that cannot be read is no cap.
 */
export async function spendSince(since: Date): Promise<{ usd: number; calls: number }> {
  if (!dbConfigured()) throw new Error("DATABASE_URL is not set, so spend cannot be measured against the cap.");
  const [row] = await db()
    .select({ usd: sql<string>`coalesce(sum(${schema.aiUsage.usd}), 0)`, calls: sql<number>`count(*)::int` })
    .from(schema.aiUsage)
    .where(gte(schema.aiUsage.at, since));
  return { usd: Number(row?.usd ?? 0), calls: Number(row?.calls ?? 0) };
}

/** A measurement budget: `--cap-usd 4.75 --since 2026-11-05T22:00:00Z`, checked against ai_usage before each paid step. */
export function capFromArgs(argv: string[]): { cap: number; since: Date } | null {
  const get = (n: string) => {
    const i = argv.indexOf(n);
    return i > 0 ? argv[i + 1] : undefined;
  };
  const cap = get("--cap-usd");
  const since = get("--since");
  if (!cap && !since) return null;
  if (!cap || !since || !Number.isFinite(Number(cap)) || Number.isNaN(Date.parse(since))) throw new Error("Pass both --cap-usd <dollars> and --since <ISO time>.");
  return { cap: Number(cap), since: new Date(since) };
}

/** Today's spend per feature, largest first, for /status in Technical view. Empty without a database. */
export async function spendByRouteToday(): Promise<{ route: string; calls: number; usd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }[]> {
  if (!dbConfigured()) return [];
  try {
    const start = new Date(`${utcDay()}T00:00:00.000Z`);
    const t = schema.aiUsage;
    const rows = await db()
      .select({
        route: t.route,
        calls: sql<number>`count(*)::int`,
        usd: sql<string>`sum(${t.usd})`,
        inputTokens: sql<number>`sum(${t.inputTokens})::int`,
        outputTokens: sql<number>`sum(${t.outputTokens})::int`,
        cacheReadTokens: sql<number>`sum(${t.cacheReadInputTokens})::int`,
      })
      .from(t)
      .where(gte(t.at, start))
      .groupBy(t.route);
    return rows.map((r) => ({ ...r, usd: Number(r.usd) })).sort((a, b) => b.usd - a.usd);
  } catch {
    return [];
  }
}

/**
 * The daily AI budget in US dollars: AI_DAILY_USD when set; otherwise 2 when hosted (Render sets RENDER) and
 * unlimited on a local machine.
 */
export function dailyBudgetUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AI_DAILY_USD?.trim();
  if (raw) {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return env.RENDER ? 2 : Number.POSITIVE_INFINITY;
}

export const RESTING_PLAIN = "Our photo checker is resting for today; a person at the firm will look.";

/** True when today's spend has reached the budget, so vision checks hand over to a person. */
export async function overBudget(): Promise<{ over: boolean; usd: number; budget: number }> {
  const budget = dailyBudgetUsd();
  if (!Number.isFinite(budget)) return { over: false, usd: 0, budget };
  const { usd } = await spendToday();
  return { over: usd >= budget, usd, budget };
}

/** For tests: forget this process's in-memory spend. */
export function resetMemorySpend() {
  memory = { day: "", usd: 0 };
}
