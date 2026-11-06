/** The recall explorer's results and count cards (src/app/recalls). Server only. */
import { loadRecalls } from "@/lib/recall/search";
import { QUERY_WINDOW, findRecalls, matches, toApiHit, type ExplorerFilters } from "./recall-data";

/**
 * The explorer's page of results, with how many recalls fit each photo-refund choice under the other filters
 * (the count cards). One search call: with words, the reranked window is fetched once and split in code.
 */
export async function explore(o: { query: string; filters: ExplorerFilters; show: number }) {
  const { photoRefund, ...rest } = o.filters;
  const show = Math.max(20, Math.min(o.show, 1300));
  if (!o.query.trim()) {
    const base = loadRecalls()
      .filter((r) => matches(r, rest))
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    const counts = { all: base.length, photo: base.filter((r) => r.photoRefund).length };
    const list = photoRefund === undefined ? base : base.filter((r) => r.photoRefund === photoRefund);
    return { mode: "list" as const, model: null, reranker: null, counts: { ...counts, other: counts.all - counts.photo }, total: list.length, hits: list.slice(0, show).map((r) => toApiHit(r, null)) };
  }
  const r = await findRecalls({ query: o.query, filters: rest, limit: QUERY_WINDOW });
  const counts = { all: r.hits.length, photo: r.hits.filter((h) => h.photo_refund).length };
  const list = photoRefund === undefined ? r.hits : r.hits.filter((h) => h.photo_refund === photoRefund);
  return { mode: r.mode, model: r.model, reranker: r.reranker, counts: { ...counts, other: counts.all - counts.photo }, total: list.length, hits: list.slice(0, show) };
}
