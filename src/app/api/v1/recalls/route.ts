import { connection } from "next/server";
import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { filtersFrom, findRecalls } from "@/lib/api/recall-data";
import { agencyTier, NOT_CHECKED } from "@/lib/recall/agencies";

/**
 * GET /api/v1/recalls?query=&photo_refund=&year=&category=&remedy=&units=&limit=&offset=[&agencies=1]
 * Hybrid search over US consumer product recalls since 2024 (Elastic: keyword and semantic, fused, reranked), or the
 * newest recalls that fit the filters when there are no words. Each hit carries its proof rule in short.
 * When the CPSC search has no good hit for the words (or with agencies=1), the FDA and NHTSA are asked too, each
 * best-effort with a timeout; their hits come back labelled in `agencies`.
 */
export async function GET(req: Request) {
  await connection();
  return guard(req, "v1.recalls", async () => {
    const started = Date.now();
    const p = new URL(req.url).searchParams;
    const { query, filters, limit, offset } = filtersFrom(p);
    if (limit < 1) return fail("invalid_request", "limit must be between 1 and 100.", 400);
    try {
      const r = await findRecalls({ query, filters, limit, offset });
      const words = query.trim();
      const agencies = words
        ? await agencyTier(words, { mode: r.mode === "list" ? "local" : r.mode, hits: r.hits.map((h) => ({ title: h.title, productNames: h.product_names, score: h.score ?? 0 })) }, { force: p.get("agencies") === "1" })
        : NOT_CHECKED;
      return ok({ query, filters, total: r.total, hits: r.hits, agencies }, started, { search: { mode: r.mode, model: r.model, reranker: r.reranker, agencies: agencies.checked ? agencies.agencies : [] } });
    } catch (e) {
      console.error("v1.recalls failed", e);
      return fail("internal", "The recall search did not finish. Please try again.", 500);
    }
  });
}
