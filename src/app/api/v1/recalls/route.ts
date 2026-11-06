import { connection } from "next/server";
import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { filtersFrom, findRecalls } from "@/lib/api/recall-data";

/**
 * GET /api/v1/recalls?query=&photo_refund=&year=&category=&remedy=&units=&limit=&offset=
 * Hybrid search over US consumer product recalls since 2024 (Elastic: keyword and semantic, fused, reranked), or the
 * newest recalls that fit the filters when there are no words. Each hit carries its proof rule in short.
 */
export async function GET(req: Request) {
  await connection();
  return guard(req, "v1.recalls", async () => {
    const started = Date.now();
    const { query, filters, limit, offset } = filtersFrom(new URL(req.url).searchParams);
    if (limit < 1) return fail("invalid_request", "limit must be between 1 and 100.", 400);
    try {
      const r = await findRecalls({ query, filters, limit, offset });
      return ok({ query, filters, total: r.total, hits: r.hits }, started, { search: { mode: r.mode, model: r.model, reranker: r.reranker } });
    } catch (e) {
      console.error("v1.recalls failed", e);
      return fail("internal", "The recall search did not finish. Please try again.", 500);
    }
  });
}
