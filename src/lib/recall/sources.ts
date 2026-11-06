/**
 * Recall lookups across three US agencies, each best-effort with its own timeout, so one being down never blocks the
 * others:
 *   - CPSC (consumer products): the live Recalls API, each hit tagged when its remedy pays a refund for a photo.
 *   - FDA (food and drugs): openFDA enforcement reports.
 *   - NHTSA (vehicles and equipment): recalls by make, model and year, or by keyword over the NHTSA recalls dataset.
 * Remedy automates photo refunds for CPSC recalls only; FDA and NHTSA hits are shown for the owner, labelled, with a
 * link to the agency's page.
 */
import { classifyRemedy } from "./classify";
import { USER_AGENT } from "./cpsc-client";
import { tokens } from "./search";

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

/** Where each agency lists its recalls; the link an owner follows when a hit has no page of its own. */
export const AGENCY_PAGES: Record<Agency, { name: string; url: string }> = {
  CPSC: { name: "US Consumer Product Safety Commission", url: "https://www.cpsc.gov/Recalls" },
  FDA: { name: "US Food and Drug Administration", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" },
  NHTSA: { name: "National Highway Traffic Safety Administration", url: "https://www.nhtsa.gov/recalls" },
};

/** The one sentence shown beside an FDA or NHTSA hit. */
export const AGENCY_NOTE = "Remedy automates photo refunds for CPSC recalls; this one is handled by the agency and the firm.";

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

const clip = (s: string | undefined | null, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

interface CpscRaw {
  RecallNumber?: string;
  Title?: string;
  RecallDate?: string;
  URL?: string;
  Products?: { Name?: string }[];
  Hazards?: { Name?: string }[];
  Remedies?: { Name?: string }[];
}

export async function searchCpsc(q: string, limit: number, ms = 9000): Promise<RecallHit[]> {
  try {
    const data = (await fetchJson(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&ProductName=${encodeURIComponent(q)}`, ms)) as CpscRaw[];
    const seen = new Set<string>();
    const out: RecallHit[] = [];
    for (const r of Array.isArray(data) ? data : []) {
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
    classification?: string;
    recalling_firm?: string;
    recall_initiation_date?: string;
    recall_number?: string;
    event_id?: string;
  }[];
}

export function fmtFdaDate(d?: string): string {
  if (!d || d.length !== 8) return "";
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** The recall's entry in the FDA's enforcement report search, by event id. */
export const fdaEventUrl = (eventId?: string) => (eventId && /^\d+$/.test(eventId) ? `https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=${eventId}` : AGENCY_PAGES.FDA.url);

export async function searchFda(kind: "food" | "drug", q: string, limit: number, ms = 9000): Promise<RecallHit[]> {
  // Every significant word must appear (AND of exact terms), so "infant formula" does not match a tuna salad whose
  // description merely contains "formula".
  const terms = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  if (!terms.length) return [];
  const expr = terms.map((t) => `product_description:%22${encodeURIComponent(t)}%22`).join("+AND+");
  try {
    const data = (await fetchJson(`https://api.fda.gov/${kind}/enforcement.json?search=${expr}&sort=recall_initiation_date:desc&limit=${limit}`, ms)) as FdaRaw;
    return (data.results ?? []).map((r) => ({
      agency: "FDA" as const,
      title: clip(r.product_description, 140),
      hazard: clip(r.reason_for_recall, 300),
      remedy: [r.classification, r.status ? `recall ${r.status.toLowerCase()}` : "", r.recalling_firm ? `by ${r.recalling_firm}` : ""].filter(Boolean).join(", ") || undefined,
      date: fmtFdaDate(r.recall_initiation_date),
      url: fdaEventUrl(r.event_id),
      ref: `FDA-${r.recall_number ?? r.event_id ?? q}`,
    }));
  } catch {
    return [];
  }
}

interface NhtsaVehicleRaw {
  results?: { Component?: string; Summary?: string; Remedy?: string; NHTSACampaignNumber?: string; ReportReceivedDate?: string }[];
}

/** "Honda Civic 2018" or "2018 honda civic" as make, model and year for NHTSA's vehicle lookup. */
export function parseVehicle(q: string): { make: string; model: string; year: string } | null {
  const m = q.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const year = m[0];
  const rest = q.replace(year, "").trim().split(/\s+/).filter(Boolean);
  if (rest.length < 2) return null;
  return { make: rest[0], model: rest.slice(1).join(" "), year };
}

/** NHTSA's dates come as "28/05/2020"; the dataset's as "2024-12-20T00:00:00.000". Both become YYYY-MM-DD. */
export function fmtNhtsaDate(d?: string): string {
  if (!d) return "";
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(d);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "";
}

export const nhtsaRecallUrl = (campaign?: string) => (campaign ? `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(campaign)}` : AGENCY_PAGES.NHTSA.url);

async function searchNhtsaVehicle(v: { make: string; model: string; year: string }, limit: number, ms: number): Promise<RecallHit[]> {
  try {
    const data = (await fetchJson(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}&modelYear=${encodeURIComponent(v.year)}`, ms)) as NhtsaVehicleRaw;
    return (data.results ?? []).slice(0, limit).map((r) => ({
      agency: "NHTSA" as const,
      title: clip(`${v.year} ${v.make} ${v.model}: ${r.Component ?? "recall"}`, 140),
      hazard: clip(r.Summary, 300),
      remedy: clip(r.Remedy, 300) || undefined,
      date: fmtNhtsaDate(r.ReportReceivedDate),
      url: nhtsaRecallUrl(r.NHTSACampaignNumber),
      ref: `NHTSA-${r.NHTSACampaignNumber ?? `${v.year}-${v.make}-${v.model}`}`,
    }));
  } catch {
    return [];
  }
}

type NhtsaDatasetRaw = { nhtsa_id?: string; subject?: string; component?: string; manufacturer?: string; defect_summary?: string; consequence_summary?: string; corrective_action?: string; report_received_date?: string; recall_type?: string }[];

/**
 * Keyword search over NHTSA's recalls dataset (data.transportation.gov, "Recalls Data"), newest first. The dataset's
 * full-text search is loose, so each hit must still name every significant word of the query ("air bag" counts for
 * "airbag").
 */
async function searchNhtsaKeyword(q: string, limit: number, ms: number): Promise<RecallHit[]> {
  const terms = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  if (!terms.length) return [];
  try {
    const url = `https://data.transportation.gov/resource/6axg-epim.json?$q=${encodeURIComponent(q)}&$limit=${limit * 3}&$order=report_received_date%20DESC`;
    const data = (await fetchJson(url, ms)) as NhtsaDatasetRaw;
    const names = (r: NhtsaDatasetRaw[number]) => {
      const text = [r.manufacturer, r.subject, r.component, r.defect_summary, r.consequence_summary, r.corrective_action].join(" ").toLowerCase();
      const packed = text.replace(/\s+/g, "");
      return terms.every((t) => text.includes(t) || packed.includes(t));
    };
    return (Array.isArray(data) ? data : []).filter(names).slice(0, limit).map((r) => ({
      agency: "NHTSA" as const,
      title: clip([r.manufacturer, r.subject ?? r.component].filter(Boolean).join(": "), 140),
      hazard: clip(r.consequence_summary || r.defect_summary, 300),
      remedy: clip(r.corrective_action, 300) || undefined,
      date: fmtNhtsaDate(r.report_received_date),
      url: nhtsaRecallUrl(r.nhtsa_id),
      ref: `NHTSA-${r.nhtsa_id ?? q}`,
    }));
  } catch {
    return [];
  }
}

export async function searchNhtsa(q: string, limit: number, ms = 9000): Promise<RecallHit[]> {
  const v = parseVehicle(q);
  if (v) {
    const byVehicle = await searchNhtsaVehicle(v, limit, ms);
    if (byVehicle.length) return byVehicle;
  }
  return searchNhtsaKeyword(q, limit, ms);
}

/**
 * FDA (food and drug) and NHTSA at once, each inside its own timeout. The answer never throws: an agency that is down
 * or slow simply returns no hits, and `down` names it.
 */
export async function searchAgencies(query: string, opts: { perSource?: number; timeoutMs?: number } = {}): Promise<{ hits: RecallHit[]; agencies: Agency[]; ms: number }> {
  const q = query.trim();
  const started = Date.now();
  if (!q) return { hits: [], agencies: [], ms: 0 };
  const per = opts.perSource ?? 3;
  const ms = opts.timeoutMs ?? 6000;
  const settled = await Promise.allSettled([searchFda("food", q, per, ms), searchFda("drug", q, per, ms), searchNhtsa(q, per, ms)]);
  const hits = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  const seen = new Set<string>();
  const unique = hits.filter((h) => !seen.has(h.ref) && seen.add(h.ref));
  return { hits: unique, agencies: [...new Set(unique.map((h) => h.agency))], ms: Date.now() - started };
}

/** Every agency, with the live CPSC database first. */
export async function searchAllSources(query: string, perSource = 4): Promise<{ hits: RecallHit[]; agencies: Agency[] }> {
  const q = query.trim();
  if (!q) return { hits: [], agencies: [] };
  const [cpsc, rest] = await Promise.all([searchCpsc(q, perSource), searchAgencies(q, { perSource })]);
  const hits = [...cpsc, ...rest.hits];
  return { hits, agencies: [...new Set(hits.map((h) => h.agency))] };
}

/** The words of a query that name the product: lower case, stemmed, with stop words and filler dropped. */
export function queryWords(query: string): string[] {
  const FILLER = new Set(["over", "under", "near", "my", "our", "that", "which", "tips", "tip", "fall", "break", "broke", "catch", "catches", "fire", "burn", "burns"]);
  return [...new Set(tokens(query).filter((w) => w.length >= 3 && !FILLER.has(w)))];
}

/**
 * Whether the stored CPSC search found the product the words name: one of the top three hits names every product
 * word of the query in its product names or title. Elastic's fused score says how hits rank, not whether the top one
 * fits, so the same word rule applies in both modes. The second-tier agency lookup runs only when this is false.
 */
export function goodCpscHit(query: string, hits: { title: string; productNames: string[]; score: number }[], _mode: "elastic" | "local" | "list" = "local"): boolean {
  void _mode;
  if (!hits.length) return false;
  const words = queryWords(query);
  if (!words.length) return true;
  return hits.slice(0, 3).some((h) => {
    const text = tokens(`${h.productNames.join(" ")} ${h.title}`).join(" ");
    return words.every((w) => text.includes(w));
  });
}
