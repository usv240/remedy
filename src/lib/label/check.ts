/**
 * From a label reading to a recall, in code: the catalog scan's own matcher (src/lib/recall/scan.ts, the same rules a
 * firm's catalog scan uses) with Claude left out, so one label costs one model call, the reading, and no more. Server
 * only.
 *
 *   1. The reading is checked first (src/lib/label/reading.ts): fields not found in their own line, or read with low
 *      confidence, are set aside; a person in the photo stops here.
 *   2. Each model number read becomes one catalog row (brand, product name, model, UPC); a label with no model is one
 *      row with its UPC.
 *   3. A model number or UPC in a recall's own list settles it: one such recall is a match; more than one, the owner
 *      picks. Words alone never settle it: recalls whose words cover the label's are shown as candidates to compare.
 *   4. Lot, batch and date codes are never decided here. When the recall states them and the label shows one, both are
 *      returned side by side; the claim's own check (C4) compares them when the recall's proof rule asks for it.
 */
import { imagesFor, recallByNumber } from "@/lib/api/recall-data";
import { codeOf, codeText, looksLikeModel } from "@/lib/recall/codes";
import { scanCatalog, type ScanAlternative, type ScanItem, type ScanRecall, type ScanRow } from "@/lib/recall/scan";
import type { Recall } from "@/lib/recall/types";
import { extractModels } from "@/lib/verify/identifiers";
import { codesPhrase, MAX_MODELS, nameQuery, readLabelFields, type ReadLabel } from "./reading";
import type { LabelReading } from "./schema";
import type { LabelCheck, LabelMatch } from "./types";

/** Candidates shown when no code settles it. */
export const MAX_CANDIDATES = 3;

/** The catalog rows one label makes: one per model number used, else one with the UPC or the words alone. */
export function labelItems(l: ReadLabel): ScanItem[] {
  const name = l.product?.used ? l.product.value : "";
  const brand = l.brand?.used ? l.brand.value : null;
  const sku = l.upc?.used ? l.upc.digits : null;
  const models = l.models.filter((m) => m.used).slice(0, MAX_MODELS);
  if (models.length) return models.map((m) => ({ name, brand, model: m.value, sku }));
  if (sku || name || brand) return [{ name, brand, sku }];
  return [];
}

/** The model numbers a recall lists: the CPSC's model field and the models its text names. */
export function recallModels(r: Recall): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim().replace(/[.,;:]+$/, "");
    // A UPC the text names beside the model is not a model number.
    if (/^(?:UPC|EAN|GTIN)s?\b/i.test(t) || /^\d{8,14}$/.test(codeOf(t))) return;
    if (t && looksLikeModel(t) && !out.some((x) => codeOf(x) === codeOf(t))) out.push(t);
  };
  for (const p of r.products) for (const x of p.model.split(/[,;]/)) add(x);
  for (const m of extractModels(codeText(r))) add(m);
  return out.slice(0, 8);
}

const LOT_WORDS = /\b(lot|batch|date codes?|serial|manufactur\w*|production date|produced)\b/i;

/** Sentences of the recall's own text that name lots, batches, serials or manufacture dates. */
export function lotSentences(r: Recall): string[] {
  const text = [r.description, ...r.products.map((p) => p.description)].join(" ");
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => LOT_WORDS.test(s) && !/^made in [A-Z]/i.test(s.trim()))
    .map((s) => (s.length > 260 ? `${s.slice(0, 257)}...` : s))
    .filter((s, i, a) => a.indexOf(s) === i)
    .slice(0, 2);
}

const kindWord: Record<string, string> = { lot: "Lot", batch: "Batch", serial: "Serial", date_code: "Date code", manufacture_date: "Made" };

function toMatch(r: Recall, s: ScanRecall, by: LabelMatch["matched_by"], l: ReadLabel, item: ScanItem | null, confidence: number): LabelMatch {
  const code = by === "model" ? (item?.model ?? null) : by === "upc" ? (l.upc?.digits ?? null) : null;
  const models = recallModels(r);
  const how =
    by === "model"
      ? `Matched by model number ${code}, read from your photo.`
      : by === "upc"
        ? `Matched by UPC ${code}, read from your photo.`
        : `Close by name: the recall's product and firm cover ${Math.round(confidence * 100)}% of the label's words${l.models.some((m) => m.used) && models.length ? `, but it lists ${models.length === 1 ? "model" : "models"} ${models.slice(0, 4).join(", ")}. Check your label` : ""}.`;
  const states = lotSentences(r);
  const shows = l.lots.filter((x) => x.used).map((x) => `${kindWord[x.kind] ?? "Code"}: ${x.value}`);
  const img = imagesFor(r)[0];
  return {
    number: r.number,
    title: r.title,
    product: r.products.find((p) => p.name)?.name ?? r.title,
    date: r.date,
    sample: Boolean(r.sample),
    photo_refund: r.photoRefund,
    remedy_summary: s.remedy_summary,
    refund_amount: s.refund_amount,
    refund_amount_text: s.refund_amount_text,
    claim_url: r.photoRefund ? `/claim/${r.number}` : null,
    page: `/recalls/${r.number}`,
    cpsc_url: r.url,
    image: img?.thumb ?? (img?.url.startsWith("/") ? img.url : null),
    matched_by: by,
    code,
    how,
    recall_models: models,
    compare: states.length && shows.length ? { recall_states: states, label_shows: shows } : null,
  };
}

type Found = { recall: ScanRecall; by: LabelMatch["matched_by"]; confidence: number; item: ScanItem | null };

/** Every recall the rows found, code matches first, each once. */
function gather(rows: ScanRow[], items: ScanItem[]): Found[] {
  const out: Found[] = [];
  const add = (f: Found) => {
    const at = out.findIndex((x) => x.recall.number === f.recall.number);
    if (at < 0) out.push(f);
    else if (out[at].by === "keywords" && f.by !== "keywords") out[at] = f;
    else if (out[at].by === f.by && f.confidence > out[at].confidence) out[at] = { ...out[at], confidence: f.confidence };
  };
  rows.forEach((row, i) => {
    const item = items[i] ?? null;
    if (row.recall && row.matched_by && row.matched_by !== "claude") add({ recall: row.recall, by: row.matched_by, confidence: row.confidence, item });
    for (const a of row.alternatives ?? ([] as ScanAlternative[])) if (a.matched_by !== "claude") add({ recall: a.recall, by: a.matched_by, confidence: a.confidence, item });
  });
  return out.sort((a, b) => Number(b.by !== "keywords") - Number(a.by !== "keywords") || b.confidence - a.confidence);
}

/** The whole check, from Claude's reading to the answer. No model call here. */
export async function checkReading(reading: LabelReading): Promise<Omit<LabelCheck, "source">> {
  const label = readLabelFields(reading);
  const search = nameQuery(label);
  const base = { label, search, matches: [] as LabelMatch[] };
  if (label.person) {
    return { ...base, outcome: "person", plain: "Please take a photo of just the label, with no people in it.", technical: `Person in the photo${label.person.where ? ` (${label.person.where})` : ""}: the reading is not used, and the photo was never stored.` };
  }
  const items = labelItems(label);
  if (!label.readable || !label.searchable || !items.length) {
    return {
      ...base,
      outcome: "unreadable",
      plain: label.retake_tip || "We could not read the label. Take a closer photo of it, flat and in good light, or search by name.",
      technical: `readable ${label.readable}; nothing usable to look up (models ${label.models.length}, UPC ${label.upc ? "read" : "none"}, brand ${label.brand?.used ? "yes" : "no"}, product ${label.product?.used ? "yes" : "no"}).`,
    };
  }
  const report = await scanCatalog(items, { ai: false, alternatives: 4 });
  const found = gather(report.results, items);
  const coded = found.filter((f) => f.by !== "keywords");
  const words = found.filter((f) => f.by === "keywords");
  const make = (f: Found) => {
    const r = recallByNumber(f.recall.number);
    return r ? toMatch(r, f.recall, f.by, label, f.item, f.confidence) : null;
  };
  const rows = `${items.length} catalog ${items.length === 1 ? "row" : "rows"} (${items.map((i) => [i.brand, i.name, i.model ? `model ${i.model}` : "", i.sku ? `UPC ${i.sku}` : ""].filter(Boolean).join(", ")).join("; ")}), scanned with Claude off; search ${report.search.mode ?? "none"}`;
  if (coded.length === 1) {
    const m = make(coded[0])!;
    return { ...base, outcome: "match", matches: [m], plain: m.how, technical: `${rows}. ${coded[0].by === "model" ? "Model" : "UPC"} ${m.code} is in recall ${m.number}'s own list, which settles it in code.` };
  }
  if (coded.length > 1) {
    const ms = coded.slice(0, 4).map(make).filter((m): m is LabelMatch => m !== null);
    return { ...base, outcome: "candidates", matches: ms, plain: `${ms.length} recalls list a code read from your label. Compare each with your product and pick yours.`, technical: `${rows}. The code is in more than one recall's own list: ${ms.map((m) => `${m.number} (${m.matched_by} ${m.code})`).join(", ")}.` };
  }
  if (words.length) {
    const ms = words.slice(0, MAX_CANDIDATES).map(make).filter((m): m is LabelMatch => m !== null);
    const codes = codesPhrase(label);
    return {
      ...base,
      outcome: "candidates",
      matches: ms,
      plain: codes ? `No recall lists ${codes}, but ${ms.length === 1 ? "one recall is" : `${ms.length} recalls are`} close by name. Compare the model on your label with each.` : `${ms.length === 1 ? "One recall is" : `${ms.length} recalls are`} close by name. Compare the model on your label with each.`,
      technical: `${rows}. No code match; candidates by words: ${ms.map((m) => m.number).join(", ")}. Words alone never settle a label.`,
    };
  }
  const codes = codesPhrase(label);
  return {
    ...base,
    outcome: "no_match",
    plain: codes ? `No recall since January 2024 lists ${codes}.` : `No recall since January 2024 matches ${search || "this label"}.`,
    technical: `${rows}. No recall's own codes hold what was read, and no recall's words come close.`,
  };
}
