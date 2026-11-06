import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ctxOr } from "@/lib/firm/api";
import { parseSales, publicLine } from "@/lib/firm/buyers";
import { saveMatchedSales, targetsFor } from "@/lib/firm/buyers-data";

/**
 * POST /api/firm/buyers/import (multipart "file", or text/csv): match each line of a sales file to the recalled
 * product, and save the matched lines as sales (contacts encrypted). Returns every line with contacts masked.
 */
export async function POST(req: Request) {
  return guard(req, "firm.buyers.import", async () => {
    const started = Date.now();
    const url = new URL(req.url);
    const got = await ctxOr({ recall: url.searchParams.get("recall") });
    if ("error" in got) return got.error;
    let text = "";
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return fail("invalid_request", "Choose a CSV file to upload.", 400);
      if (file.size > 2_000_000) return fail("invalid_request", "That file is over 2 MB. Split it into smaller files.", 413);
      text = await file.text();
    } else {
      text = await req.text();
      if (text.length > 2_000_000) return fail("invalid_request", "That file is over 2 MB. Split it into smaller files.", 413);
    }
    if (!text.trim()) return fail("invalid_request", "The file is empty.", 400);
    const parsed = parseSales(text, targetsFor(got.recall), new Date());
    if (parsed.errors.length && !parsed.lines.length) return fail("invalid_request", parsed.errors[0], 400, parsed.errors);
    const saved = await saveMatchedSales(got.ctx.firm, got.recall, parsed.lines);
    const bySale = new Map(saved.map((s) => [s.line, s.saleId]));
    return ok(
      {
        recall: { number: got.recall.number, short: got.recall.short },
        total: parsed.total,
        matched: parsed.lines.filter((l) => l.matched).length,
        lines: parsed.lines.map((l) => ({ ...publicLine(l), saleId: bySale.get(l.line) ?? null })),
        warnings: parsed.errors,
      },
      started,
    );
  });
}
