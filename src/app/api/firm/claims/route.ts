import { ok } from "@/lib/api/envelope";
import { ctxOr } from "@/lib/firm/api";
import { queueRows } from "@/lib/firm/queue";
import { ensureReadyClaims } from "@/lib/firm/sample-claims";

/**
 * GET /api/firm/claims: every claim of the sample firm, newest first, with checks, decision and payout status. Two sample
 * claims are kept ready to pay ($1.00 each), so the queue always has something for Approve and pay.
 */
export async function GET() {
  const started = Date.now();
  const got = await ctxOr();
  if ("error" in got) return got.error;
  await ensureReadyClaims(got.ctx.firm.id, got.ctx.main?.number).catch(() => 0);
  const rows = await queueRows(got.ctx.firm.id);
  return ok({ firm: { name: got.ctx.firm.name, is_sample: got.ctx.firm.isSample }, claims: rows }, started, { count: rows.length });
}
