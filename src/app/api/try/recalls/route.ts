import { ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { searchRecalls } from "@/lib/recall/search";
import { goodCpscHit } from "@/lib/recall/sources";
import { thumbFor } from "../../claims/_lib/recall";

/**
 * GET /api/try/recalls?q=power+bank[&photo=1]: recalls for the owner's "Find your recall" box (Elastic hybrid search,
 * or the in-app ranking when Elastic is not connected). `photo=1` keeps only recalls that refund for a photo.
 * `cpsc_good` says whether the CPSC search found the product; when it did not, the box asks /api/try/agencies next.
 */
export async function GET(req: Request) {
  return guard(req, "GET /api/try/recalls", async () => {
    const started = Date.now();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    const photo = url.searchParams.get("photo") === "1";
    const res = await searchRecalls(q, { k: 8, filters: photo ? { photoRefund: true } : {} });
    // The photo filter can hide a CPSC hit; "good" is judged on an unfiltered look so a known product never goes to the FDA.
    const unfiltered = photo && !goodCpscHit(q, res.hits, res.mode) && q ? await searchRecalls(q, { k: 3 }) : res;
    const good = q ? goodCpscHit(q, unfiltered.hits, unfiltered.mode) : true;
    return ok(
      {
        query: q,
        mode: res.mode,
        hits: res.hits.map((h) => ({ number: h.number, title: h.title, product: h.productNames[0] ?? h.title, date: h.date, photo_refund: h.photoRefund, image: thumbFor(h.number, 0) })),
        cpsc_good: good,
        cpsc_elsewhere: photo && !res.hits.length && good ? unfiltered.hits.slice(0, 3).map((h) => ({ number: h.number, title: h.title, product: h.productNames[0] ?? h.title, date: h.date })) : [],
      },
      started,
    );
  });
}
