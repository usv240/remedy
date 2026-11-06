import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ctxOr, jsonBody } from "@/lib/firm/api";
import { isMonth } from "@/lib/firm/dates";
import { narrativeFor } from "@/lib/firm/narrative";
import { loadReport } from "@/lib/firm/report-data";

/**
 * POST /api/firm/reports/narrative { month, recall? }: write the report's summary paragraph with Claude Haiku 5.5 from
 * the SQL numbers, once per month (stored). Asked again with the same numbers, it returns the stored paragraph.
 */
export async function POST(req: Request) {
  return guard(req, "firm.reports.narrative", async () => {
    const started = Date.now();
    const body = await jsonBody<{ month?: unknown; recall?: unknown }>(req);
    const got = await ctxOr({ recall: typeof body?.recall === "string" ? body.recall : null });
    if ("error" in got) return got.error;
    const month = typeof body?.month === "string" ? body.month : "";
    if (!isMonth(month)) return fail("invalid_request", "Use a month like 2026-11.", 400);
    const n = await loadReport(got.ctx.firm, got.recall, month);
    if (!n) return fail("not_found", "That month is before this recall was announced.", 404);
    return ok(await narrativeFor(got.ctx.firm, got.recall, n, { write: true }), started);
  });
}
