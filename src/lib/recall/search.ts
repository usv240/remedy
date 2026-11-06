/** Recall search: Elastic hybrid search over the `remedy-recalls` index, with an in-app BM25 fallback over recalls.json. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { categorize } from "./classify";
import { searchCpscLive } from "./cpsc-client";
import { normalizeRecall } from "./ingest";
import type { ProofRule } from "./proof-rule";
import type { Recall, RecallsFile } from "./types";

export const INDEX = "remedy-recalls";
export const EMBEDDING_MODEL = ".jina-embeddings-v3";
export const RERANKER = ".jina-reranker-v3";

export type SearchFilters = { photoRefund?: boolean; year?: number | string; category?: string };
export type RecallHit = {
  number: string;
  title: string;
  date: string;
  category: string;
  productNames: string[];
  photoRefund: boolean;
  units: number | null;
  image: string | null;
  url: string;
  score: number;
};
export type SearchResult = { mode: "elastic" | "local"; model: string | null; reranker: string | null; hits: RecallHit[] };

// ---------------------------------------------------------------- Data

let cache: { file: RecallsFile; at: number } | null = null;
/**
 * recalls.json, read once per process from the app root: the CPSC recalls only. Statistics, the explorer's list and
 * counts, and the benchmark read this, so the fictional sample recalls never count in them.
 */
export function loadRecalls(): Recall[] {
  if (!cache) cache = { file: JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "recalls.json"), "utf8")) as RecallsFile, at: Date.now() };
  return cache.file.recalls;
}

export type SamplesFile = { note: string; recalls: Recall[]; rules: Record<string, ProofRule> };
let samples: SamplesFile | null = null;
/** content/recalls/samples.json: the fictional sample firm's own recalls (Brightline Home), each marked sample: true. */
export function loadSamplesFile(): SamplesFile {
  if (!samples) {
    try {
      const f = JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "samples.json"), "utf8")) as SamplesFile;
      samples = { note: f.note ?? "", recalls: (f.recalls ?? []).map((r) => ({ ...r, sample: true as const })), rules: f.rules ?? {} };
    } catch {
      samples = { note: "", recalls: [], rules: {} };
    }
  }
  return samples;
}
export const loadSampleRecalls = (): Recall[] => loadSamplesFile().recalls;

/** Every recall a page, a claim or the API can open: the sample recalls first, then the CPSC recalls. */
export function loadAllRecalls(): Recall[] {
  return [...loadSampleRecalls(), ...loadRecalls()];
}

const SAMPLE_STOP = new Set(["recall", "recalls", "recalled", "the", "and", "for", "with"]);
/**
 * Sample recalls that match a search: only when every meaningful word of the query appears in the sample, so a
 * search for "power bank" never puts the sample charger above real CPSC recalls.
 */
export function sampleHits(query: string, opts: { filters?: SearchFilters } = {}): RecallHit[] {
  const words = query.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length >= 3 && !SAMPLE_STOP.has(w));
  if (!words.length) return [];
  return loadSampleRecalls()
    .filter((r) => matchesFilters(r, opts.filters))
    .filter((r) => {
      const text = [r.number, r.title, r.description, r.hazard, r.remedyText, ...r.products.map((p) => p.name)].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .map((r) => ({ ...localSearch(query, { recalls: [r], k: 1 })[0], ...hitOf(r) }));
}

function hitOf(r: Recall): Omit<RecallHit, "score"> & { score?: number } {
  return { number: r.number, title: r.title, date: r.date, category: r.category, productNames: [...new Set(r.products.map((p) => p.name).filter(Boolean))], photoRefund: r.photoRefund, units: r.units, image: r.images[0]?.url ?? null, url: r.url };
}

/** The document indexed for one recall. `summary` is the short text the reranker reads. */
export function recallDoc(r: Recall) {
  const productNames = [...new Set(r.products.map((p) => p.name).filter(Boolean))];
  return {
    number: r.number,
    title: r.title,
    date: r.date,
    year: Number(r.date.slice(0, 4)) || null,
    units: r.units,
    category: r.category,
    productNames: productNames.join("; "),
    models: r.products.map((p) => p.model).filter(Boolean).join("; ").slice(0, 4000),
    productTypes: [...new Set(r.products.map((p) => p.type).filter(Boolean))],
    hazard: r.hazard.slice(0, 2000),
    remedyText: r.remedyText.slice(0, 4000),
    firms: r.manufacturers.join("; "),
    retailers: r.retailers.join("; ").slice(0, 2000),
    photoRefund: r.photoRefund,
    flags: r.flags,
    url: r.url,
    image: r.images[0]?.url ?? null,
    summary: `${productNames.join("; ")}. ${r.title}. ${r.category}.`.slice(0, 1500),
  };
}
type Doc = ReturnType<typeof recallDoc>;

const toHit = (d: Pick<Doc, "number" | "title" | "date" | "category" | "productNames" | "photoRefund" | "units" | "image" | "url">, score: number): RecallHit => ({
  number: d.number,
  title: d.title,
  date: d.date,
  category: d.category,
  productNames: d.productNames ? d.productNames.split("; ") : [],
  photoRefund: d.photoRefund,
  units: d.units,
  image: d.image,
  url: d.url,
  score: Math.round(score * 1000) / 1000,
});

// ---------------------------------------------------------------- In-app BM25

const STOP = new Set(
  "the and for that this with from are was were has have had not but you your his her their they them its can will would should may any all one who what when how does did into than then also our out per each recall recalls recalled due risk hazard hazards sold".split(" "),
);
/** Lower case, words of 2+ letters, a light plural strip ("heaters" to "heater", "batteries" to "battery"). */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

type Bm = { recalls: Recall[]; tf: Map<string, number>[]; len: number[]; df: Map<string, number>; avg: number; phrase: string[] };
const bmCache = new WeakMap<Recall[], Bm>();
function bm25Index(recalls: Recall[]): Bm {
  const hit = bmCache.get(recalls);
  if (hit) return hit;
  const fields = (r: Recall) => {
    const names = r.products.map((p) => p.name).join(" ");
    // Product names and the title count most; the category and firm help; hazard text a little.
    return [names, names, names, r.title, r.title, r.category, r.products.map((p) => p.model).join(" ").slice(0, 400), r.manufacturers.join(" "), r.hazard.slice(0, 300)].join(" ");
  };
  const tf = recalls.map((r) => {
    const m = new Map<string, number>();
    for (const w of tokens(fields(r))) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  });
  const len = tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  for (const m of tf) for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const phrase = recalls.map((r) => ` ${tokens(`${r.products.map((p) => p.name).join(" ")} ${r.title}`).join(" ")} `);
  const built = { recalls, tf, len, df, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length), phrase };
  bmCache.set(recalls, built);
  return built;
}

export function matchesFilters(r: Pick<Recall, "photoRefund" | "date" | "category">, f: SearchFilters = {}): boolean {
  if (f.photoRefund !== undefined && r.photoRefund !== f.photoRefund) return false;
  if (f.year !== undefined && f.year !== "" && r.date.slice(0, 4) !== String(f.year)) return false;
  if (f.category && r.category.toLowerCase() !== f.category.toLowerCase()) return false;
  return true;
}

/** BM25 over product names, titles, categories and firms, with a bonus when the whole query appears as a phrase. */
export function localSearch(query: string, opts: { k?: number; filters?: SearchFilters; recalls?: Recall[] } = {}): RecallHit[] {
  const recalls = opts.recalls ?? loadRecalls();
  const { tf, len, df, avg, phrase } = bm25Index(recalls);
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const qPhrase = ` ${q.join(" ")} `;
  // A query that names a kind of product ("space heater" is a heater) lifts recalls in that category.
  const qCategory = categorize(query, [query], "");
  const N = recalls.length;
  const scored: { i: number; s: number }[] = [];
  for (let i = 0; i < N; i++) {
    if (!matchesFilters(recalls[i], opts.filters)) continue;
    let s = 0;
    let matched = 0;
    for (const w of q) {
      const f = tf[i].get(w) ?? 0;
      if (!f) continue;
      matched++;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (len[i] / avg))));
    }
    if (!s) continue;
    if (q.length > 1) {
      s *= 0.5 + (0.5 * matched) / q.length; // every query word present ranks above some of them
      if (phrase[i].includes(qPhrase)) s *= 1.6;
    }
    if (qCategory !== "Other" && recalls[i].category === qCategory) s *= 1.8;
    scored.push({ i, s });
  }
  scored.sort((a, b) => b.s - a.s || (recalls[b.i].date > recalls[a.i].date ? 1 : -1));
  return scored.slice(0, opts.k ?? 10).map(({ i, s }) => toHit(recallDoc(recalls[i]), s));
}

// ---------------------------------------------------------------- Elastic

export const elasticConfigured = () => Boolean(process.env.ELASTIC_URL?.trim() && process.env.ELASTIC_API_KEY?.trim());
const esUrl = () => process.env.ELASTIC_URL!.trim().replace(/\/$/, "");

async function es<T>(p: string, init: RequestInit = {}, ms = 20_000): Promise<{ status: number; body: T }> {
  const r = await fetch(`${esUrl()}${p}`, {
    ...init,
    headers: {
      Authorization: `ApiKey ${process.env.ELASTIC_API_KEY!.trim()}`,
      "Content-Type": init.body && String(init.body).includes("\n{") ? "application/x-ndjson" : "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(ms),
  });
  const body = (await r.json().catch(() => ({}))) as T;
  return { status: r.status, body };
}

const MAPPING = {
  number: { type: "keyword" },
  title: { type: "text", copy_to: "semantic" },
  date: { type: "date" },
  year: { type: "integer" },
  units: { type: "long" },
  category: { type: "keyword", copy_to: "semantic" },
  productNames: { type: "text", copy_to: "semantic" },
  models: { type: "text" },
  productTypes: { type: "keyword" },
  hazard: { type: "text" },
  remedyText: { type: "text" },
  firms: { type: "text" },
  retailers: { type: "text" },
  photoRefund: { type: "boolean" },
  flags: { properties: { photo: { type: "boolean" }, refund: { type: "boolean" }, marker: { type: "boolean" }, cut: { type: "boolean" }, email: { type: "boolean" }, webmail: { type: "boolean" } } },
  url: { type: "keyword", index: false },
  image: { type: "keyword", index: false },
  summary: { type: "text" },
};

/**
 * Delete and rebuild the index from recalls.json: semantic_text on jina-embeddings-v3 (falling back to the
 * deployment's default model, then to keyword only), loaded in chunks. Used by scripts/recalls/index.ts.
 */
export async function buildIndex(recalls: Recall[], log: (s: string) => void = () => {}) {
  if (!elasticConfigured()) throw new Error("Elastic is not connected (ELASTIC_URL and ELASTIC_API_KEY).");
  await es(`/${INDEX}`, { method: "DELETE" });
  let model: string | null = EMBEDDING_MODEL;
  let made = await es(`/${INDEX}`, { method: "PUT", body: JSON.stringify({ mappings: { properties: { ...MAPPING, semantic: { type: "semantic_text", inference_id: model } } } }) });
  if (made.status >= 300) {
    model = "default";
    made = await es(`/${INDEX}`, { method: "PUT", body: JSON.stringify({ mappings: { properties: { ...MAPPING, semantic: { type: "semantic_text" } } } }) });
  }
  if (made.status >= 300) {
    model = null;
    made = await es(`/${INDEX}`, { method: "PUT", body: JSON.stringify({ mappings: { properties: MAPPING } }) });
  }
  if (made.status >= 300) throw new Error(`Elastic could not create the index (${made.status})`);
  log(`created ${INDEX} (semantic model: ${model ?? "none"})`);
  const docs = recalls.map(recallDoc);
  const CHUNK = 100;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const lines = docs.slice(i, i + CHUNK).flatMap((d) => [JSON.stringify({ index: { _index: INDEX, _id: d.number } }), JSON.stringify(d)]);
    const bulk = await es<{ errors?: boolean; items?: { index?: { error?: { reason?: string } } }[] }>(`/_bulk`, { method: "POST", body: lines.join("\n") + "\n" }, 180_000);
    if (bulk.status >= 300 || bulk.body.errors) {
      const reason = bulk.body.items?.find((x) => x.index?.error)?.index?.error?.reason;
      throw new Error(`Elastic could not load recalls ${i} to ${i + CHUNK} (${bulk.status}${reason ? `: ${reason}` : ""})`);
    }
    log(`loaded ${Math.min(i + CHUNK, docs.length)}/${docs.length}`);
  }
  await es(`/${INDEX}/_refresh`, { method: "POST" });
  const count = await es<{ count?: number }>(`/${INDEX}/_count`);
  return { docs: count.body.count ?? 0, semantic: model !== null, model };
}

let semantic: Promise<string | null> | null = null;
/** The index's semantic model, read from its mapping once per process; null when the index has none. */
function semanticModel() {
  semantic ??= es<Record<string, { mappings?: { properties?: { semantic?: { inference_id?: string } } } }>>(`/${INDEX}/_mapping`).then((m) => {
    if (m.status >= 300) throw new Error(`no index (${m.status})`);
    const s = m.body[INDEX]?.mappings?.properties?.semantic;
    return s ? (s.inference_id ?? "default") : null;
  });
  semantic.catch(() => {
    semantic = null;
  });
  return semantic;
}

function esFilters(f: SearchFilters = {}) {
  const out: unknown[] = [];
  if (f.photoRefund !== undefined) out.push({ term: { photoRefund: f.photoRefund } });
  if (f.year !== undefined && f.year !== "") out.push({ term: { year: Number(f.year) } });
  if (f.category) out.push({ term: { category: f.category } });
  return out;
}

const SOURCE = ["number", "title", "date", "category", "productNames", "photoRefund", "units", "image", "url"];

/** Elastic hybrid search: keyword plus semantic, fused by RRF, reranked by jina-reranker-v3. Throws when Elastic fails. */
export async function elasticSearch(query: string, opts: { k?: number; filters?: SearchFilters } = {}): Promise<SearchResult> {
  const k = opts.k ?? 10;
  const filter = esFilters(opts.filters);
  const model = await semanticModel();
  const lexical = {
    standard: {
      query: {
        bool: {
          must: { multi_match: { query, fields: ["productNames^3", "title^2", "category^2", "models^2", "firms", "summary", "hazard^0.3", "remedyText^0.2"], type: "best_fields", tie_breaker: 0.3 } },
          filter,
        },
      },
    },
  };
  const semanticRetriever = { standard: { query: { bool: { must: { semantic: { field: "semantic", query } }, filter } } } };
  const fused = { rrf: { retrievers: [lexical, semanticRetriever], rank_window_size: 50, rank_constant: 20 } };
  const search = (body: unknown) => es<{ hits?: { hits?: { _score: number | null; _source: Doc }[] } }>(`/${INDEX}/_search`, { method: "POST", body: JSON.stringify(body) });
  const toHits = (hits: { _score: number | null; _source: Doc }[]) => hits.map((h, i) => toHit(h._source, h._score ?? 1 / (i + 1)));
  if (model) {
    const ranked = await search({ retriever: { text_similarity_reranker: { retriever: fused, field: "summary", inference_id: RERANKER, inference_text: query, rank_window_size: 30 } }, size: k, _source: SOURCE });
    if (ranked.status < 300 && ranked.body.hits?.hits) return { mode: "elastic", model, reranker: RERANKER, hits: toHits(ranked.body.hits.hits) };
    const r = await search({ retriever: fused, size: k, _source: SOURCE });
    if (r.status < 300 && r.body.hits?.hits) return { mode: "elastic", model, reranker: null, hits: toHits(r.body.hits.hits) };
  }
  const r = await search({ query: lexical.standard.query, size: k, _source: SOURCE });
  if (r.status < 300 && r.body.hits?.hits) return { mode: "elastic", model: null, reranker: null, hits: toHits(r.body.hits.hits) };
  throw new Error(`Elastic search failed (${r.status})`);
}

/**
 * Search recalls. Server-only.
 *   - Elastic, when ELASTIC_URL and ELASTIC_API_KEY are set: keyword (multi_match) and semantic (semantic_text on
 *     jina-embeddings-v3) retrievers fused by reciprocal rank (RRF), then reranked by jina-reranker-v3.
 *     Filters: photo refund, year, product category.
 *   - Otherwise, or when Elastic does not answer: the in-app BM25 over recalls.json.
 * `searchLive` covers recalls outside the snapshot.
 */
export async function searchRecalls(query: string, opts: { k?: number; filters?: SearchFilters } = {}): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { mode: elasticConfigured() ? "elastic" : "local", model: null, reranker: null, hits: [] };
  // A matching sample recall (fictional, marked sample) comes first; the CPSC results follow unchanged.
  const samples = sampleHits(q, opts);
  const withSamples = (r: SearchResult): SearchResult => (samples.length ? { ...r, hits: [...samples, ...r.hits.filter((h) => !samples.some((s) => s.number === h.number))].slice(0, Math.max(opts.k ?? r.hits.length, samples.length)) } : r);
  if (elasticConfigured()) {
    try {
      return withSamples(await elasticSearch(q, opts));
    } catch {
      /* fall through to the in-app ranking */
    }
  }
  return withSamples({ mode: "local", model: null, reranker: null, hits: localSearch(q, opts) });
}

/** Live lookup: the full CPSC database by product name, normalized to `Recall`. */
export async function searchLive(query: string, limit = 8): Promise<Recall[]> {
  return (await searchCpscLive(query, limit)).map(normalizeRecall);
}
