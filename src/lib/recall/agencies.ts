/**
 * The second tier of "find your recall": when the stored CPSC search has no good hit for the words, ask the FDA (food
 * and drugs) and NHTSA (vehicles and equipment), each best-effort inside its own timeout, and return their hits
 * labelled by agency. Remedy automates photo refunds for CPSC recalls only; an FDA or NHTSA hit links to the agency.
 * Server only.
 */
import { AGENCY_NOTE, AGENCY_PAGES, goodCpscHit, searchAgencies, type Agency, type RecallHit as SourceHit } from "./sources";
import type { RecallHit, SearchResult } from "./search";

export type AgencyHit = {
  agency: Exclude<Agency, "CPSC">;
  agency_name: string;
  ref: string;
  title: string;
  hazard: string;
  remedy: string | null;
  date: string;
  url: string;
  note: string;
};

export type AgencyTier = { checked: boolean; hits: AgencyHit[]; agencies: Agency[]; ms: number; note: string };

export const toAgencyHit = (h: SourceHit): AgencyHit => ({
  agency: h.agency === "CPSC" ? "FDA" : h.agency,
  agency_name: AGENCY_PAGES[h.agency].name,
  ref: h.ref,
  title: h.title,
  hazard: h.hazard,
  remedy: h.remedy ?? null,
  date: h.date,
  url: h.url ?? AGENCY_PAGES[h.agency].url,
  note: AGENCY_NOTE,
});

export const NOT_CHECKED: AgencyTier = { checked: false, hits: [], agencies: [], ms: 0, note: "The CPSC search found the product, so the other agencies were not asked." };

/**
 * FDA and NHTSA hits for the query, only when the CPSC search has no good hit. `force` asks them regardless.
 */
export type CpscLook = { mode: SearchResult["mode"]; hits: Pick<RecallHit, "title" | "productNames" | "score">[] };

export async function agencyTier(query: string, cpsc: CpscLook, opts: { force?: boolean; timeoutMs?: number } = {}): Promise<AgencyTier> {
  if (!opts.force && goodCpscHit(query, cpsc.hits, cpsc.mode)) return NOT_CHECKED;
  const r = await searchAgencies(query, { perSource: 3, timeoutMs: opts.timeoutMs ?? 6000 });
  const hits = r.hits.filter((h) => h.agency !== "CPSC").map(toAgencyHit);
  return {
    checked: true,
    hits,
    agencies: [...new Set(hits.map((h) => h.agency))],
    ms: r.ms,
    note: hits.length ? AGENCY_NOTE : "The FDA and NHTSA databases have no recall for these words either, or did not answer in time.",
  };
}
