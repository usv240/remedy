/** Recall ingest: normalizes CPSC API records into the `Recall` shape written to content/recalls/recalls.json. */
import { categorize, classifyRemedy, emailsIn, parseUnits, remedyTextOf } from "./classify";
import { fetchAllCpscRecalls, CPSC_API } from "./cpsc-client";
import type { RawCpscRecall, Recall, RecallFirm, RecallsFile } from "./types";

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();
const names = (xs: { Name?: string }[] | undefined) => (xs ?? []).map((x) => clean(x.Name)).filter(Boolean);
const KNOWN_OPTIONS = new Set(["Refund", "Replace", "Repair", "Dispose", "Inspect", "New Instructions", "Label"]);

export function normalizeRecall(r: RawCpscRecall): Recall {
  const remedyText = clean(remedyTextOf(r));
  const consumerContact = clean(r.ConsumerContact);
  const flags = classifyRemedy(remedyText, consumerContact);
  const products = (r.Products ?? []).map((p) => ({
    name: clean(p.Name),
    model: clean(p.Model),
    description: clean(p.Description),
    type: clean(p.Type),
    units: parseUnits(p.NumberOfUnits),
    unitsText: clean(p.NumberOfUnits),
  }));
  const firms: RecallFirm[] = [
    ...names(r.Manufacturers).map((name) => ({ name, role: "manufacturer" as const })),
    ...names(r.Importers).map((name) => ({ name, role: "importer" as const })),
    ...names(r.Distributors).map((name) => ({ name, role: "distributor" as const })),
  ];
  const upcs = (r.ProductUPCs ?? []).map((u) => (typeof u === "string" ? u : (u.UPC ?? ""))).map(clean).filter(Boolean);
  const title = clean(r.Title);
  return {
    number: clean(r.RecallNumber),
    title,
    date: (r.RecallDate ?? "").slice(0, 10),
    units: products[0]?.units ?? null,
    hazard: clean(names(r.Hazards).join(" ")),
    remedyText,
    remedies: [...new Set((r.RemedyOptions ?? []).map((o) => clean(o.Option)).filter((o) => KNOWN_OPTIONS.has(o)))],
    products,
    images: (r.Images ?? []).filter((i) => i.URL).map((i) => ({ url: clean(i.URL), caption: clean(i.Caption) })),
    retailers: names(r.Retailers),
    manufacturers: [...new Set(firms.map((f) => f.name))],
    consumerContact,
    url: clean(r.URL),
    photoRefund: flags.photo && flags.refund,
    flags,
    category: categorize(title, products.map((p) => p.name), products.find((p) => p.type)?.type),
    recallId: r.RecallID ?? 0,
    description: clean(r.Description),
    injuries: names(r.Injuries),
    firms,
    countries: (r.ManufacturerCountries ?? []).map((c) => clean(c.Country)).filter(Boolean),
    upcs,
    emails: emailsIn(`${remedyText} ${consumerContact}`),
    lastPublishDate: (r.LastPublishDate ?? "").slice(0, 10),
  };
}

/** Normalize, de-duplicate by recall number (the first record wins) and sort newest first, then by number. */
export function normalizeAll(raw: RawCpscRecall[]): Recall[] {
  const seen = new Set<string>();
  const out: Recall[] = [];
  for (const r of raw) {
    if (!r.RecallNumber || seen.has(r.RecallNumber)) continue;
    seen.add(r.RecallNumber);
    out.push(normalizeRecall(r));
  }
  return out.sort((a, b) => (a.date === b.date ? b.number.localeCompare(a.number) : a.date < b.date ? 1 : -1));
}

export function recallsFile(raw: RawCpscRecall[], startDate: string, pulledAt = new Date().toISOString()): RecallsFile {
  const recalls = normalizeAll(raw);
  const dates = recalls.map((r) => r.date).filter(Boolean).sort();
  return {
    pulledAt,
    source: `${CPSC_API}?format=json&RecallDateStart=${startDate} (US Consumer Product Safety Commission, public domain)`,
    range: { from: dates[0] ?? startDate, to: dates.at(-1) ?? startDate },
    count: recalls.length,
    recalls,
  };
}

/** Pull and normalize in one step (the raw response is returned too, for caching). */
export async function ingestCpsc(startDate = "2024-01-01") {
  const raw = await fetchAllCpscRecalls(startDate);
  return { raw, file: recallsFile(raw, startDate) };
}
