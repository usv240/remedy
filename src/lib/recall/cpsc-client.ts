/** Client for the public CPSC Recalls API (saferproducts.gov, no key, public domain): recalls since a date, one by number, or a live product search. */
import type { RawCpscRecall } from "./types";

export const CPSC_API = "https://www.saferproducts.gov/RestWebServices/Recall";
export const USER_AGENT = "Remedy/0.1 (recall refund research; github.com/usv240/remedy)";

/** Keywords for nursery and juvenile products, for a juvenile-only view. */
export const NURSERY_KEYWORDS = [
  "crib", "bassinet", "stroller", "sleeper", "nursery", "infant", "toddler",
  "baby", "car seat", "high chair", "playard", "swaddle", "cradle", "bouncer",
  "changing table", "rocker", "nursing", "pacifier", "booster seat", "child",
];

export function matchesNursery(r: RawCpscRecall): boolean {
  const hay = [r.Title ?? "", r.Description ?? "", ...(r.Products ?? []).map((p) => p.Name ?? "")].join(" ").toLowerCase();
  return NURSERY_KEYWORDS.some((k) => hay.includes(k));
}

async function getJson(url: string, ms: number): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`CPSC API ${res.status}`);
  return res.json();
}

/** Every recall with RecallDate on or after `startDate` (YYYY-MM-DD), as the API returns them. */
export async function fetchAllCpscRecalls(startDate = "2024-01-01", ms = 120_000): Promise<RawCpscRecall[]> {
  const data = await getJson(`${CPSC_API}?format=json&RecallDateStart=${encodeURIComponent(startDate)}`, ms);
  if (!Array.isArray(data)) throw new Error("CPSC API returned something other than a list");
  return data as RawCpscRecall[];
}

/** One recall by its number ("27056"), or null. */
export async function fetchCpscRecall(recallNumber: string, ms = 15_000): Promise<RawCpscRecall | null> {
  const n = recallNumber.trim().replace(/^CPSC-?/i, "");
  if (!/^\d{2}-?\d{3,4}$/.test(n)) return null;
  const data = (await getJson(`${CPSC_API}?format=json&RecallNumber=${encodeURIComponent(n.replace("-", ""))}`, ms)) as RawCpscRecall[];
  return (Array.isArray(data) ? data : []).find((r) => r.RecallNumber === n.replace("-", "")) ?? null;
}

/** Live search of the full CPSC database by product name, newest first, de-duplicated. */
export async function searchCpscLive(query: string, limit = 8, ms = 9_000): Promise<RawCpscRecall[]> {
  const q = query.trim();
  if (!q) return [];
  const data = (await getJson(`${CPSC_API}?format=json&ProductName=${encodeURIComponent(q)}`, ms)) as RawCpscRecall[];
  const seen = new Set<string>();
  const out: RawCpscRecall[] = [];
  for (const r of Array.isArray(data) ? data : []) {
    if (!r.RecallNumber || seen.has(r.RecallNumber)) continue;
    seen.add(r.RecallNumber);
    out.push(r);
  }
  out.sort((a, b) => ((a.RecallDate ?? "") < (b.RecallDate ?? "") ? 1 : -1));
  return out.slice(0, limit);
}

/** The recall page's year folder and slug change; the API's URL field is the stable link. */
export const recallPageUrl = (r: RawCpscRecall) => r.URL ?? `https://www.cpsc.gov/Recalls?search=${encodeURIComponent(r.RecallNumber ?? "")}`;
