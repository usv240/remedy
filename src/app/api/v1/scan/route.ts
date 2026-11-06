import { connection } from "next/server";
import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ScanRequest } from "@/lib/api/v1-schemas";
import { keyIdFor } from "@/lib/api/verify-service";
import { publicOrigin } from "@/lib/origin";
import { SCAN_LIMITS, scanCatalog, scanCsv } from "@/lib/recall/scan";
import { parseCatalogCsv } from "@/lib/recall/scan-csv";

/**
 * POST /api/v1/scan: { items: [{ name, model?, sku?, brand? }] } (JSON), or the catalog as text/csv.
 * Each row comes back photo_refund, recalled, clear or unknown, with the matching recall and the claim link.
 * Up to SCAN_LIMITS.freeItems rows without a key; up to SCAN_LIMITS.maxItems with one. `?format=csv` returns a CSV.
 */
export async function POST(req: Request) {
  await connection();
  return guard(req, "v1.scan", async () => {
    const started = Date.now();
    const url = new URL(req.url);
    const type = req.headers.get("content-type") ?? "";
    let body: unknown;
    if (type.includes("text/csv") || type.includes("multipart/form-data")) {
      let text = "";
      if (type.includes("multipart/form-data")) {
        const form = await req.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return fail("invalid_request", "Send the catalog as a CSV file in the file field.", 400);
        if (file.size > 2_000_000) return fail("invalid_request", "That file is over 2 MB. Split it into smaller files.", 413);
        text = await file.text();
      } else text = await req.text();
      if (text.length > 2_000_000) return fail("invalid_request", "That file is over 2 MB. Split it into smaller files.", 413);
      const parsed = parseCatalogCsv(text, SCAN_LIMITS.maxItems);
      if (!parsed.items.length) return fail("invalid_request", parsed.warnings[0] ?? "No rows with a product name were found.", 400, parsed.warnings);
      body = { items: parsed.items, ai: url.searchParams.get("ai") !== "false" };
    } else {
      body = await req.json().catch(() => null);
      if (!body) return fail("invalid_request", 'The request body must be JSON, for example { "items": [{ "name": "HAIARA power bank" }] }, or a CSV with Content-Type text/csv.', 400);
    }
    const parsed = ScanRequest.safeParse(body);
    if (!parsed.success) return fail("invalid_request", parsed.error.issues[0]?.message ?? "The request is not valid.", 422, parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    const { items, ai } = parsed.data;
    if (items.length > SCAN_LIMITS.freeItems && !(await keyIdFor(req))) {
      return fail("unauthorized", `More than ${SCAN_LIMITS.freeItems} rows needs an API key. Get a free one on the Developers page, or send up to ${SCAN_LIMITS.freeItems} rows at a time.`, 401);
    }
    try {
      const report = await scanCatalog(items, { ai });
      const origin = publicOrigin(req);
      const results = report.results.map((r) => ({ ...r, claim_url: r.claim_url ? `${origin}${r.claim_url}` : null, recall: r.recall ? { ...r.recall, page: `${origin}${r.recall.page}` } : null }));
      if (url.searchParams.get("format") === "csv") {
        return new Response(scanCsv(report, origin), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="remedy-scan.csv"' } });
      }
      return ok({ summary: report.summary, results, ai: report.ai }, started, { search: report.search, scan_ms: report.ms });
    } catch (e) {
      console.error("v1.scan failed", e);
      return fail("internal", "The scan did not finish. Please try again.", 500);
    }
  });
}
