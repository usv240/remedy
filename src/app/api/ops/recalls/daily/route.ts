import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { fail, ok } from "@/lib/api/envelope";
import { log, withRequest } from "@/lib/log";
import { lastRun, runDaily } from "@/lib/recall/daily";

export const maxDuration = 300;

/** True when the request carries this server's CHECKS_SECRET as a bearer token or in x-checks-secret. Never without one set. */
function authorized(req: Request): boolean {
  const secret = process.env.CHECKS_SECRET?.trim();
  const h = req.headers.get("authorization");
  const got = (h?.toLowerCase().startsWith("bearer ") ? h.slice(7) : (req.headers.get("x-checks-secret") ?? "")).trim();
  if (!secret || !got) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/ops/recalls/daily: the daily recall ingest (scripts/recalls/daily.ts), run by Render's cron job with the
 * server's CHECKS_SECRET. Body (optional JSON): { dry, since, until, max_rules, cap_usd }. Without the secret the route
 * does not exist. GET answers with the last recorded run.
 */
export async function POST(req: Request) {
  await connection();
  return withRequest(req, "POST /api/ops/recalls/daily", async () => {
    if (!authorized(req)) return fail("not_found", "Not found.", 404);
    const started = Date.now();
    const body = (await req.json().catch(() => ({}))) as { dry?: boolean; since?: string; until?: string; max_rules?: number; cap_usd?: number };
    const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
    const lines: string[] = [];
    try {
      const r = await runDaily({ dry: body.dry === true, since: day(body.since), until: day(body.until), maxRules: n(body.max_rules), capUsd: n(body.cap_usd), log: (s) => lines.push(s) });
      log.info("recall-ingest finished", { dry: body.dry === true, ms: Date.now() - started });
      return ok({ ...r, log: lines.slice(-200) }, started);
    } catch (e) {
      log.error("recall-ingest failed", { error: e });
      return fail("internal", `The daily ingest stopped: ${e instanceof Error ? e.message : String(e)}`, 500, { log: lines.slice(-50) });
    }
  });
}

export async function GET(req: Request) {
  await connection();
  return withRequest(req, "GET /api/ops/recalls/daily", async () => {
    if (!authorized(req)) return fail("not_found", "Not found.", 404);
    return ok({ last_run: await lastRun() }, Date.now());
  });
}
