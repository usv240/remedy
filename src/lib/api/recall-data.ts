/**
 * Recall data for the public API, the MCP tools and the public pages: one recall, its stored proof rule, the
 * extraction trace behind it, the raw CPSC record, and search with the explorer's filters. Server only.
 *
 * Every file is read once per process from content/recalls (written by the data builder's scripts).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { desc, inArray, isNotNull } from "drizzle-orm";
import { db, dbConfigured, schema } from "@/lib/db";
import { normalizeRecall } from "@/lib/recall/ingest";
import { loadAllRecalls, loadRecalls, loadSamplesFile, searchRecalls, type SearchFilters } from "@/lib/recall/search";
import type { ProofRule } from "@/lib/recall/proof-rule";
import type { RawCpscRecall, Recall } from "@/lib/recall/types";
import type { RuleSummary } from "./rule-chips";

const DIR = path.join(process.cwd(), "content", "recalls");
const readJson = <T>(...p: string[]): T => JSON.parse(readFileSync(path.join(DIR, ...p), "utf8")) as T;

// ---------------------------------------------------------------- Files

type RulesFile = {
  model: string;
  extractedAt: string;
  method: string;
  counts: { recalls: number; photoRefund: number };
  sources: Record<string, "selfcheck" | "plain" | "baseline">;
  rules: Record<string, ProofRule>;
};
type ImageRow = { url: string; caption: string; thumb: string; width: number; height: number; dhash: string };
type ExtractOutput = { rule: ProofRule | null; usage: { input_tokens: number; output_tokens: number } | null; stopReason: string | null; model: string; error: unknown };
type ExtractFile = { model: string; variant: string; mode: string; batchId: string; createdAt: string; outputs: Record<string, ExtractOutput> };

let rulesFile: RulesFile | null = null;
let images: Record<string, ImageRow[]> | null = null;
let byNumber: Map<string, Recall> | null = null;
let raw: Map<string, RawCpscRecall> | null = null;
let extract: { plain: ExtractFile | null; selfcheck: ExtractFile | null } | null = null;

export const rules = () => (rulesFile ??= readJson<RulesFile>("proof-rules.json"));
const imageRows = () => (images ??= readJson<Record<string, ImageRow[]>>("image-hashes.json"));

// ---------------------------------------------------------------- Rows added since the release

/**
 * Recalls the daily ingest stored after this release (src/lib/recall/daily.ts): rows in the recall table that are not
 * in the committed file, read back from the raw CPSC record they carry, with their proof rules. Refreshed every five
 * minutes by the async entry points (search, one recall, the scan, the badge), so a sync lookup sees them too.
 */
type Overlay = { at: number; recalls: Map<string, Recall>; rules: Map<string, { rule: ProofRule; source: string; model: string | null }> };
let overlay: Overlay | null = null;
let overlayLoading: Promise<void> | null = null;
const OVERLAY_TTL_MS = 5 * 60_000;

export async function refreshOverlay(): Promise<void> {
  if (!dbConfigured()) return;
  if (overlay && Date.now() - overlay.at < OVERLAY_TTL_MS) return;
  overlayLoading ??= (async () => {
    try {
      const inFile = new Set(loadAllRecalls().map((r) => r.number));
      const rows = await db().select({ number: schema.recalls.number, raw: schema.recalls.raw }).from(schema.recalls).where(isNotNull(schema.recalls.raw));
      const fresh = rows.filter((r) => !inFile.has(r.number) && r.raw && typeof r.raw === "object").map((r) => normalizeRecall(r.raw as RawCpscRecall)).filter((r) => r.number);
      const rules = new Map<string, { rule: ProofRule; source: string; model: string | null }>();
      if (fresh.length) {
        const list = await db()
          .select({ n: schema.proofRules.recallNumber, rule: schema.proofRules.rule, source: schema.proofRules.source, model: schema.proofRules.model })
          .from(schema.proofRules)
          .where(inArray(schema.proofRules.recallNumber, fresh.map((r) => r.number)))
          .orderBy(desc(schema.proofRules.version));
        for (const r of list) if (!rules.has(r.n)) rules.set(r.n, { rule: r.rule as ProofRule, source: r.source, model: r.model });
      }
      const changed = !overlay || fresh.length !== overlay.recalls.size || fresh.some((r) => !overlay!.recalls.has(r.number));
      overlay = { at: Date.now(), recalls: new Map(fresh.map((r) => [r.number, r])), rules };
      if (changed) byNumber = null;
    } catch {
      // Without the table (an empty database) the committed file is the whole list; try again after the usual wait.
      overlay = { at: Date.now(), recalls: new Map(), rules: new Map() };
    } finally {
      overlayLoading = null;
    }
  })();
  await overlayLoading;
}

/** How many recalls the overlay holds, for tests and the status page. */
export const overlaySize = () => overlay?.recalls.size ?? 0;

/** A CPSC recall, or one of the fictional sample firm's recalls (marked sample: true). */
export function recallByNumber(n: string): Recall | null {
  byNumber ??= new Map([...loadAllRecalls(), ...(overlay?.recalls.values() ?? [])].map((r) => [r.number, r]));
  return byNumber.get(normalizeNumber(n)) ?? null;
}

/**
 * "27056", "Recall 27056", "26-127" and the cpsc.gov recall URL all name a recall number. A sample recall number
 * ("bh-2026-01") comes back in capitals.
 */
export function normalizeNumber(s: string): string {
  const t = String(s ?? "").trim();
  const sample = /\bBH-\d{4}-\d{2}\b/i.exec(t);
  if (sample) return sample[0].toUpperCase();
  const m = /\b(\d{2})-?(\d{3})\b/.exec(t);
  return m ? `${m[1]}${m[2]}` : t;
}

/** The raw record from the CPSC Recalls API, exactly as it came (content/recalls/raw/cpsc-recalls.json). */
export function rawRecord(n: string): RawCpscRecall | null {
  raw ??= new Map(readJson<RawCpscRecall[]>("raw", "cpsc-recalls.json").map((r) => [String(r.RecallNumber), r]));
  return raw.get(normalizeNumber(n)) ?? null;
}

/** The stored rule and where it came from. */
export function storedRule(n: string): { rule: ProofRule; source: string; model: string; extractedAt: string; method: string } | null {
  const num = normalizeNumber(n);
  // A sample recall's rule was written by hand by the sample firm: no model, no extraction run.
  const own = loadSamplesFile().rules[num];
  if (own) return { rule: own, source: "firm", model: "none (written by the sample firm)", extractedAt: "", method: "Written by hand by Brightline Home, a fictional sample firm. No model call." };
  const f = rules();
  const rule = f.rules[num];
  if (rule) return { rule, source: f.sources[num] ?? "selfcheck", model: f.model, extractedAt: f.extractedAt, method: f.method };
  // A recall the daily ingest stored after this release: its rule is in the database.
  const fresh = overlay?.rules.get(num);
  if (fresh) {
    return fresh.source === "ai"
      ? { rule: fresh.rule, source: "selfcheck", model: fresh.model ?? "claude-opus-5-5", extractedAt: "", method: "Read by the daily recall ingest: Claude Opus 5.5 with structured output at medium effort, then a self-check pass." }
      : { rule: fresh.rule, source: "baseline", model: "none (quick read)", extractedAt: "", method: "Read by the daily recall ingest with the deterministic quick read: keyword rules over the remedy text, no model call." };
  }
  return null;
}

export const summarize = (r: ProofRule): RuleSummary => ({
  photo_required: r.photo_required,
  actions: [...r.actions],
  marker_text: r.marker_text,
  must_show: [...r.must_show],
  remedy: r.remedy,
  refund_amount: r.refund_amount,
  refund_amount_text: r.refund_amount_text,
  steps: [...r.steps],
});

/**
 * How the stored rule was made: Claude's first draft (Message Batches, "plain"), then the self-check pass that
 * reviewed it against the remedy text and a deterministic lint ("selfcheck"). Null when the files are missing.
 */
export function extractionTrace(n: string) {
  const num = normalizeNumber(n);
  if (!extract) {
    const load = (f: string) => (existsSync(path.join(DIR, "extract", f)) ? readJson<ExtractFile>("extract", f) : null);
    extract = { plain: load("plain.json"), selfcheck: load("selfcheck.json") };
  }
  const step = (f: ExtractFile | null) => {
    const o = f?.outputs[num];
    if (!f || !o) return null;
    return { variant: f.variant, mode: f.mode, batch_id: f.batchId, created_at: f.createdAt, model: o.model, stop_reason: o.stopReason, usage: o.usage ? { input_tokens: o.usage.input_tokens, output_tokens: o.usage.output_tokens } : null, rule: o.rule };
  };
  const draft = step(extract.plain);
  const checked = step(extract.selfcheck);
  if (!draft && !checked) return null;
  const changed = draft?.rule && checked?.rule ? (Object.keys(checked.rule) as (keyof ProofRule)[]).filter((k) => k !== "explanation" && k !== "confidence" && JSON.stringify(draft.rule![k]) !== JSON.stringify(checked.rule![k])) : [];
  return { draft, checked, changed };
}

/** Official images with a local thumbnail where one was downloaded (public/recalls/<number>/<i>.webp). */
export function imagesFor(r: Recall): { url: string; caption: string; thumb: string | null; width: number | null; height: number | null }[] {
  // A sample recall carries its own thumbnails and sizes (content/recalls/samples.json).
  const local: { url: string; thumb?: string; width?: number; height?: number }[] = r.sample ? (r.images as { url: string; thumb?: string; width?: number; height?: number }[]) : (imageRows()[r.number] ?? []);
  return r.images.map((img) => {
    const hit = local.find((l) => l.url === img.url || l.url.replace(/^https?:\/\/(www\.)?/, "") === img.url.replace(/^https?:\/\/(www\.)?/, ""));
    return { url: img.url, caption: img.caption, thumb: hit?.thumb ?? null, width: hit?.width ?? null, height: hit?.height ?? null };
  });
}

// ---------------------------------------------------------------- Filters

export const UNITS = [
  { id: "under-1k", label: "Under 1,000", min: 0, max: 999 },
  { id: "1k-10k", label: "1,000 to 9,999", min: 1000, max: 9999 },
  { id: "10k-50k", label: "10,000 to 49,999", min: 10000, max: 49999 },
  { id: "50k-plus", label: "50,000 or more", min: 50000, max: Number.POSITIVE_INFINITY },
] as const;

/** CPSC's own remedy options, as the API returns them. */
export const REMEDY_OPTIONS = ["Refund", "Repair", "Replace", "Dispose", "New Instructions", "Label", "Inspect"] as const;

export type ExplorerFilters = SearchFilters & { remedy?: string; units?: string };

export function matches(r: Recall, f: ExplorerFilters): boolean {
  if (f.photoRefund !== undefined && r.photoRefund !== f.photoRefund) return false;
  if (f.year !== undefined && f.year !== "" && r.date.slice(0, 4) !== String(f.year)) return false;
  if (f.category && r.category.toLowerCase() !== f.category.toLowerCase()) return false;
  if (f.remedy && !r.remedies.some((x) => x.toLowerCase() === f.remedy!.toLowerCase())) return false;
  if (f.units) {
    const b = UNITS.find((u) => u.id === f.units);
    if (b && (r.units === null || r.units < b.min || r.units > b.max)) return false;
  }
  return true;
}

/** The filter choices with how many recalls each holds, for the explorer's selects. Categories under 5 are left out. */
export function facets() {
  const all = loadRecalls();
  const count = <K extends string>(key: (r: Recall) => K[]) => {
    const m = new Map<K, number>();
    for (const r of all) for (const k of key(r)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const years = [...count((r) => [r.date.slice(0, 4)])].sort((a, b) => b[0].localeCompare(a[0])).map(([value, n]) => ({ value, count: n }));
  const categories = [...count((r) => [r.category])]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : a[0].localeCompare(b[0])))
    .map(([value, n]) => ({ value, count: n }));
  const rem = count((r) => r.remedies);
  const remedies = REMEDY_OPTIONS.filter((x) => (rem.get(x) ?? 0) > 0).map((value) => ({ value, count: rem.get(value) ?? 0 }));
  const units = UNITS.map((u) => ({ value: u.id, label: u.label, count: all.filter((r) => r.units !== null && r.units >= u.min && r.units <= u.max).length }));
  return { total: all.length, photoRefund: all.filter((r) => r.photoRefund).length, years, categories, remedies, units };
}

// ---------------------------------------------------------------- Search

export type ApiHit = {
  number: string;
  title: string;
  date: string;
  category: string;
  product_names: string[];
  photo_refund: boolean;
  units: number | null;
  remedies: string[];
  image: { url: string; thumb: string | null; caption: string } | null;
  /** Empty for a sample recall, which has no cpsc.gov page. */
  cpsc_url: string;
  page: string;
  score: number | null;
  proof_rule: RuleSummary | null;
  /** True for a fictional sample recall (Brightline Home), never a CPSC recall. */
  sample: boolean;
};

export function toApiHit(r: Recall, score: number | null): ApiHit {
  const img = imagesFor(r)[0];
  const rule = storedRule(r.number)?.rule;
  return {
    number: r.number,
    title: r.title,
    date: r.date,
    category: r.category,
    product_names: [...new Set(r.products.map((p) => p.name).filter(Boolean))],
    photo_refund: r.photoRefund,
    units: r.units,
    remedies: r.remedies,
    image: img ? { url: img.url, thumb: img.thumb, caption: img.caption } : null,
    cpsc_url: r.url,
    page: `/recalls/${r.number}`,
    score,
    proof_rule: rule ? summarize(rule) : null,
    sample: Boolean(r.sample),
  };
}

/** The most a query returns: the reranker's window, so every hit is reranked. */
export const QUERY_WINDOW = 30;

export type FindResult = { mode: "elastic" | "local" | "list"; model: string | null; reranker: string | null; total: number; hits: ApiHit[] };

/**
 * Search or list recalls.
 *  - With words: Elastic hybrid search (keyword and semantic, fused, reranked), the in-app BM25 when Elastic is not
 *    connected, then the remedy and units filters. At most QUERY_WINDOW hits.
 *  - Without words: every recall that fits the filters, newest first.
 */
export async function findRecalls(o: { query?: string; filters?: ExplorerFilters; limit?: number; offset?: number }): Promise<FindResult> {
  await refreshOverlay();
  const f = o.filters ?? {};
  const limit = Math.max(1, Math.min(o.limit ?? 20, 100));
  const offset = Math.max(0, o.offset ?? 0);
  const q = (o.query ?? "").trim();
  if (!q) {
    const list = loadRecalls()
      .filter((r) => matches(r, f))
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    return { mode: "list", model: null, reranker: null, total: list.length, hits: list.slice(offset, offset + limit).map((r) => toApiHit(r, null)) };
  }
  const res = await searchRecalls(q, { k: QUERY_WINDOW, filters: { photoRefund: f.photoRefund, year: f.year, category: f.category } });
  const found = res.hits.map((h) => ({ r: recallByNumber(h.number), score: h.score })).filter((x): x is { r: Recall; score: number } => x.r !== null && matches(x.r, f));
  return { mode: res.mode, model: res.model, reranker: res.reranker, total: found.length, hits: found.slice(offset, offset + limit).map((x) => toApiHit(x.r, x.score)) };
}

/** Parse the explorer's and the API's query string into filters. Unknown values are ignored. */
export function filtersFrom(p: URLSearchParams): { query: string; filters: ExplorerFilters; limit: number; offset: number } {
  const bool = (v: string | null) => (v === "true" || v === "yes" || v === "1" ? true : v === "false" || v === "no" || v === "0" ? false : undefined);
  const year = p.get("year")?.trim();
  const units = p.get("units")?.trim();
  const remedy = p.get("remedy")?.trim();
  const n = (v: string | null, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
  return {
    query: (p.get("query") ?? p.get("q") ?? "").slice(0, 200),
    filters: {
      photoRefund: bool(p.get("photo_refund")),
      year: year && /^\d{4}$/.test(year) ? year : undefined,
      category: p.get("category")?.trim() || undefined,
      remedy: remedy && REMEDY_OPTIONS.some((x) => x.toLowerCase() === remedy.toLowerCase()) ? remedy : undefined,
      units: units && UNITS.some((u) => u.id === units) ? units : undefined,
    },
    limit: Math.min(n(p.get("limit"), 20), 100),
    offset: n(p.get("offset"), 0),
  };
}

/** One recall for the API and the detail page: the record, its images, and its stored proof rule. */
export function recallDetail(n: string) {
  const r = recallByNumber(n);
  if (!r) return null;
  const stored = storedRule(r.number);
  return {
    number: r.number,
    title: r.title,
    date: r.date,
    category: r.category,
    units: r.units,
    units_text: r.products[0]?.unitsText ?? null,
    hazard: r.hazard,
    remedy_text: r.remedyText,
    remedies: r.remedies,
    photo_refund: r.photoRefund,
    flags: r.flags,
    products: r.products.map((p) => ({ name: p.name, model: p.model, type: p.type, units_text: p.unitsText })),
    firms: r.firms,
    retailers: r.retailers,
    consumer_contact: r.consumerContact,
    images: imagesFor(r),
    cpsc_url: r.url,
    page: `/recalls/${r.number}`,
    claim_page: `/claim/${r.number}`,
    proof_rule: stored ? { ...stored.rule, source: stored.source, model: stored.model, extracted_at: stored.extractedAt } : null,
    /** A fictional sample recall: the sample firm's own, not from the CPSC. */
    sample: Boolean(r.sample),
    sample_note: r.sample ? "Sample recall; fictional. Brightline Home is a fictional sample firm, and this is not a CPSC recall." : null,
  };
}
export type RecallDetail = NonNullable<ReturnType<typeof recallDetail>>;
