import { ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { searchRecalls } from "@/lib/recall/search";
import { thumbFor } from "../../claims/_lib/recall";

/**
 * GET /api/try/recalls?q=power+bank[&photo=1]: recalls for the owner's "Find your recall" box (Elastic hybrid search,
 * or the in-app ranking when Elastic is not connected). `photo=1` keeps only recalls that refund for a photo.
 */
export async function GET(req: Request) {
  return guard(req, "GET /api/try/recalls", async () => {
    const started = Date.now();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    const photo = url.searchParams.get("photo") === "1";
    const res = await searchRecalls(q, { k: 8, filters: photo ? { photoRefund: true } : {} });
    return ok({ query: q, mode: res.mode, hits: res.hits.map((h) => ({ number: h.number, title: h.title, product: h.productNames[0] ?? h.title, date: h.date, photo_refund: h.photoRefund, image: thumbFor(h.number, 0) })) }, started);
  });
}
