import { ok } from "@/lib/api/envelope";
import { ctxOr } from "@/lib/firm/api";
import { queueRows } from "@/lib/firm/queue";

/** GET /api/firm/claims: every claim of the sample firm, newest first, with checks, decision and payout status. */
export async function GET() {
  const started = Date.now();
  const got = await ctxOr();
  if ("error" in got) return got.error;
  const rows = await queueRows(got.ctx.firm.id);
  return ok({ firm: { name: got.ctx.firm.name, is_sample: got.ctx.firm.isSample }, claims: rows }, started, { count: rows.length });
}
