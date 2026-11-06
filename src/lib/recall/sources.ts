/** Multi-source recall lookup across the live CPSC, FDA and NHTSA databases, each best-effort, with CPSC hits tagged for photo refunds. */
import { classifyRemedy } from "./classify";
import { USER_AGENT } from "./cpsc-client";

export type Agency = "CPSC" | "FDA" | "NHTSA";

export interface RecallHit {
  agency: Agency;
  title: string;
  hazard: string;
  remedy?: string;
  date: string;
  url?: string;
  ref: string;
  /** CPSC only: the remedy pays a refund for a photo of the product made safe. */
  photoRefund?: boolean;
}

async function fetchJson(url: string, ms = 9000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface CpscRaw {
  RecallNumber?: string;
  Title?: string;
  RecallDate?: string;
  URL?: string;
  Products?: { Name?: string }[];
  Hazards?: { Name?: string }[];
  Remedies?: { Name?: string }[];
}

async function searchCpsc(q: string, limit: number): Promise<RecallHit[]> {
  try {
    const data = (await fetchJson(
      `https://www.saferproducts.gov/RestWebServices/Recall?format=json&ProductName=${encodeURIComponent(q)}`,
    )) as CpscRaw[];
    const seen = new Set<string>();
    const out: RecallHit[] = [];
    for (const r of data) {
      if (!r.RecallNumber || seen.has(r.RecallNumber)) continue;
      seen.add(r.RecallNumber);
      const remedy = (r.Remedies ?? []).map((m) => m.Name).filter(Boolean).join(" ");
      const flags = classifyRemedy(remedy);
      out.push({
        agency: "CPSC",
        title: r.Products?.[0]?.Name ?? r.Title ?? "",
        hazard: (r.Hazards ?? []).map((h) => h.Name).filter(Boolean).join(" "),
        remedy: remedy || undefined,
        date: (r.RecallDate ?? "").slice(0, 10),
        url: r.URL || undefined,
        ref: `CPSC-${r.RecallNumber}`,
        photoRefund: flags.photo && flags.refund,
      });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    return out.slice(0, limit);
  } catch {
    return [];
  }
}

interface FdaRaw {
  results?: {
    product_description?: string;
    reason_for_recall?: string;
    status?: string;
    recall_initiation_date?: string;
    recall_number?: string;
    event_id?: string;
  }[];
}

export function fmtFdaDate(d?: string): string {
  if (!d || d.length !== 8) return "";
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

async function searchFda(kind: "food" | "drug", q: string, limit: number): Promise<RecallHit[]> {
  // Require every significant term (AND of exact terms) so "infant formula" does
  // not match a tuna salad whose description merely contains "formula".
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  if (!terms.length) return [];
  const expr = terms.map((t) => `product_description:%22${encodeURIComponent(t)}%22`).join("+AND+");
  try {
    const data = (await fetchJson(
      `https://api.fda.gov/${kind}/enforcement.json?search=${expr}&limit=${limit}`,
    )) as FdaRaw;
    return (data.results ?? []).map((r) => ({
      agency: "FDA" as const,
      title: (r.product_description ?? "").slice(0, 140),
      hazard: r.reason_for_recall ?? "",
      remedy: r.status ? `Recall status: ${r.status}` : undefined,
      date: fmtFdaDate(r.recall_initiation_date),
      url: undefined,
      ref: `FDA-${r.recall_number ?? r.event_id ?? q}-${kind}`,
    }));
  } catch {
    return [];
  }
}

interface NhtsaRaw {
  results?: {
    Component?: string;
    Summary?: string;
    Remedy?: string;
    NHTSACampaignNumber?: string;
    ReportReceivedDate?: string;
  }[];
}

/** Parse "Honda Civic 2018" style queries into make/model/year for NHTSA. */
export function parseVehicle(q: string): { make: string; model: string; year: string } | null {
  const m = q.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const year = m[0];
  const rest = q.replace(year, "").trim().split(/\s+/).filter(Boolean);
  if (rest.length < 2) return null;
  return { make: rest[0], model: rest.slice(1).join(" "), year };
}

async function searchNhtsa(q: string, limit: number): Promise<RecallHit[]> {
  const v = parseVehicle(q);
  if (!v) return [];
  try {
    const data = (await fetchJson(
      `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}&modelYear=${encodeURIComponent(v.year)}`,
    )) as NhtsaRaw;
    return (data.results ?? []).slice(0, limit).map((r) => ({
      agency: "NHTSA" as const,
      title: `${v.year} ${v.make} ${v.model}, ${r.Component ?? "recall"}`.slice(0, 140),
      hazard: r.Summary ?? "",
      remedy: r.Remedy || undefined,
      date: r.ReportReceivedDate ?? "",
      ref: `NHTSA-${r.NHTSACampaignNumber ?? q}`,
    }));
  } catch {
    return [];
  }
}

export async function searchAllSources(
  query: string,
  perSource = 4,
): Promise<{ hits: RecallHit[]; agencies: Agency[] }> {
  const q = query.trim();
  if (!q) return { hits: [], agencies: [] };

  // A vehicle query (make model year) goes to NHTSA only, so it does not pull
  // unrelated food or product matches. Fall back to the others if NHTSA is empty.
  if (parseVehicle(q)) {
    const nhtsa = await searchNhtsa(q, perSource * 2);
    if (nhtsa.length) return { hits: nhtsa, agencies: ["NHTSA"] };
  }

  const [cpsc, food, drug] = await Promise.all([
    searchCpsc(q, perSource),
    searchFda("food", q, perSource),
    searchFda("drug", q, perSource),
  ]);

  const hits = [...cpsc, ...food, ...drug];
  const agencies = Array.from(new Set(hits.map((h) => h.agency)));
  return { hits, agencies };
}
