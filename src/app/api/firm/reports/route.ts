import { fail, ok } from "@/lib/api/envelope";
import { ctxOr } from "@/lib/firm/api";
import { isMonth, monthOf } from "@/lib/firm/dates";
import { narrativeFor } from "@/lib/firm/narrative";
import { formRows, reportCsv } from "@/lib/firm/report";
import { loadReport } from "@/lib/firm/report-data";

/**
 * GET /api/firm/reports?month=YYYY-MM&recall=&format=json|csv: the CPSC monthly progress report for one month, counted
 * in SQL. JSON carries the numbers, the CPSC form's rows and the stored narrative (no model call); CSV is a download.
 */
export async function GET(req: Request) {
  const started = Date.now();
  const url = new URL(req.url);
  const got = await ctxOr({ recall: url.searchParams.get("recall") });
  if ("error" in got) return got.error;
  const month = url.searchParams.get("month") ?? monthOf(new Date());
  if (!isMonth(month)) return fail("invalid_request", "Use a month like 2026-11.", 400);
  const n = await loadReport(got.ctx.firm, got.recall, month);
  if (!n) return fail("not_found", "That month is before this recall was announced.", 404);
  if (url.searchParams.get("format") === "csv") {
    return new Response(reportCsv(n), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="cpsc-progress-report-${n.recallNumber}-${month}.csv"` },
    });
  }
  const narrative = await narrativeFor(got.ctx.firm, got.recall, n);
  return ok({ numbers: n, form: formRows(n), narrative }, started);
}
