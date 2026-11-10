/**
 * The codes a recall names (model numbers, item numbers, UPCs), as plain sets, so a product can be found by the code
 * on its label even when its words find nothing. Pure string work over the CPSC data: no network, no model calls.
 * Shared by the catalog scan (src/lib/recall/scan.ts) and the label check (src/lib/label/match.ts).
 */
import type { Recall } from "./types";

/** Lower case letters and digits only: "KC-101 B" and "kc101b" are the same code. */
export const codeOf = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A UPC, EAN or GTIN as one comparable string: digits only, leading zeros dropped. UPC-A 012345678905, EAN-13
 * 0012345678905 and GTIN-14 00012345678905 are the same product, and a label read without its leading zero still
 * matches. Null when it is not 6 to 14 digits once cleaned.
 */
export function gtin(s: string | null | undefined): string | null {
  const digits = (s ?? "").replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 14 || /[^\d\s-]/.test((s ?? "").trim())) return null;
  const g = digits.replace(/^0+/, "");
  return g.length >= 6 ? g : null;
}

/**
 * Whether a GTIN's last digit is the check digit the others give (GS1 mod 10). Reported beside a UPC read from a
 * label, never used to drop it: a match needs the exact number in a recall's own list anyway.
 */
export function gtinCheckOk(s: string | null | undefined): boolean {
  const d = (s ?? "").replace(/\D/g, "").padStart(14, "0");
  if (d.length !== 14) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(d[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(d[13]);
}

/**
 * A code distinctive enough to look up across every recall at once: letters and digits together, at least four
 * characters ("kc101b", "w5pro"), or a number of at least six digits (an item number or a UPC). A short number such as
 * "1500" or "2024" is a wattage or a year as often as a model, so it only counts among a row's search candidates.
 */
export const distinctive = (c: string) => (c.length >= 4 && /\d/.test(c) && /[a-z]/.test(c)) || /^\d{6,}$/.test(c);

/** Word-like tokens that hold a digit, each alone and joined to its neighbour ("W5 PRO" gives "w5" and "w5pro"). */
function codeTokens(text: string): string[] {
  const words = text.split(/[\s,;:()"“”'‘’#/]+/).map((w) => w.replace(/[.]+$/, "")).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const a = codeOf(words[i]);
    if (a && /\d/.test(a)) out.push(a);
    const b = i + 1 < words.length ? codeOf(words[i + 1]) : "";
    if (a && b && (/\d/.test(a) || /\d/.test(b)) && a.length + b.length <= 24) out.push(a + b);
  }
  return out;
}

const UNIT = /^\d+(?:\.\d+)?[- ]?(?:cups?|inch(?:es)?|in|oz|ounces?|packs?|pk|pieces?|pcs?|quarts?|qt|gallons?|gal|ft|feet|foot|lbs?|pounds?|mah|wh|w|v|watts?|volts?|amps?|a|mm|cm|m|ml|l|liters?|litres?|count|ct|seaters?|drawers?|tiers?|speeds?|burners?|ports?|outlets?|bulbs?|lights?|years?|months?|days?)$/i;

/**
 * Whether a code a recall's text names after "model" reads like a model number: letters and digits, not a year
 * ("2024"), a date ("07/25"), a measure ("10.83", "2-cup", "65W") or a count.
 */
export function looksLikeModel(s: string): boolean {
  const t = s.trim();
  const c = codeOf(t);
  if (!/\d/.test(c) || c.length < 2) return false;
  if (/^(?:19|20)\d{2}$/.test(c)) return false;
  if (/^\d{1,2}\/\d{2,4}$/.test(t) || /^\d+\.\d+$/.test(t)) return false;
  return !UNIT.test(t);
}

/**
 * Whether a recall's text names this model code as a whole code, letters and digits in order with any spaces, dashes,
 * dots or slashes between them, and nothing that is a letter or digit on either side: "KC101B" is found in
 * 'Model "KC-101B"' but "KC101" is not found in "KC101B", which may be another product. A model read with a short
 * variant suffix (a colour or region code: "DR-HSH015B" or "KC101B-US") is found when the recall lists it without one,
 * as the claim's model check reads it (matchModel in src/lib/verify/identifiers.ts). Returns the code found, or null.
 */
export function modelInText(read: string | null | undefined, text: string): string | null {
  const raw = (read ?? "").trim();
  const r = codeOf(raw);
  if (r.length < 4 || !/\d/.test(r)) return null;
  const tries = [r];
  // A trailing segment after a dash or a space, up to three characters ("-US", " BK"), or up to two trailing letters.
  const seg = /^(.*?)[\s-]+([a-z0-9]{1,3})$/i.exec(raw);
  if (seg && codeOf(seg[1]).length >= 4 && /\d/.test(codeOf(seg[1]))) tries.push(codeOf(seg[1]));
  const letters = /^(.*\d)([a-z]{1,2})$/i.exec(r);
  if (letters && letters[1].length >= 4) tries.push(letters[1]);
  for (const t of tries) {
    // A code is letters and digits only, so each character is safe in a pattern as it is.
    const re = new RegExp(`(?<![a-z0-9])${[...t].join(String.raw`[\s./-]*`)}(?![a-z0-9])`, "i");
    if (re.test(text)) return t;
  }
  return null;
}

/** UPC-like numbers the recall's text names after "UPC", "GTIN", "EAN" or "barcode". */
function upcsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:UPCs?|GTINs?|EANs?|bar ?codes?)\b[^0-9]{0,40}((?:\d[\d -]{4,24}\d)(?:\s*(?:,|and|or)\s*\d[\d -]{4,24}\d)*)/gi)) {
    for (const part of m[1].split(/,|\band\b|\bor\b/)) {
      const g = gtin(part.trim());
      if (g && g.length >= 7) out.push(g);
    }
  }
  return out;
}

/** The text a recall names its products and codes in: product names, models, descriptions and the recall's own description. */
export const codeText = (r: Pick<Recall, "products" | "description" | "title">) => `${r.title} ${r.products.map((p) => `${p.name} ${p.model} ${p.description}`).join(" ")} ${r.description}`;

export type RecallCodes = { models: Set<string>; upcs: Set<string> };

const codesCache = new WeakMap<Recall, RecallCodes>();
/** Every distinctive code token a recall's text holds, and its UPCs (the CPSC's UPC list and any named in its text), as GTINs. */
export function recallCodes(r: Recall): RecallCodes {
  const hit = codesCache.get(r);
  if (hit) return hit;
  const text = codeText(r);
  const models = new Set(codeTokens(text).filter(distinctive));
  const upcs = new Set([...r.upcs.map(gtin).filter((g): g is string => Boolean(g)), ...upcsInText(text)]);
  const out = { models, upcs };
  codesCache.set(r, out);
  return out;
}

type Index = { byCode: Map<string, string[]>; byGtin: Map<string, string[]> };
const indexCache = new WeakMap<readonly Recall[], Index>();
const push = (m: Map<string, string[]>, k: string, n: string) => {
  const list = m.get(k);
  if (!list) m.set(k, [n]);
  else if (!list.includes(n)) list.push(n);
};

/** The code index over a list of recalls, built once per list. */
function codeIndex(recalls: readonly Recall[]): Index {
  const hit = indexCache.get(recalls);
  if (hit) return hit;
  const byCode = new Map<string, string[]>();
  const byGtin = new Map<string, string[]>();
  for (const r of recalls) {
    const c = recallCodes(r);
    for (const m of c.models) push(byCode, m, r.number);
    for (const u of c.upcs) push(byGtin, u, r.number);
  }
  const out = { byCode, byGtin };
  indexCache.set(recalls, out);
  return out;
}

/**
 * The recalls whose own codes hold this model code or UPC, looked up across the whole list: the candidates a row's
 * code finds even when its words do not. A code that more than `maxPerCode` recalls share says too little to look up.
 */
export function recallsByCode(recalls: readonly Recall[], o: { model?: string | null; upc?: string | null }, maxPerCode = 4): string[] {
  const idx = codeIndex(recalls);
  const out: string[] = [];
  const add = (list: string[] | undefined) => {
    if (list && list.length <= maxPerCode) for (const n of list) if (!out.includes(n)) out.push(n);
  };
  const m = codeOf(o.model);
  if (m && distinctive(m)) add(idx.byCode.get(m));
  const g = gtin(o.upc);
  if (g) add(idx.byGtin.get(g));
  // A UPC sent as a model (or a model field that is a UPC) still finds its recall.
  const mg = gtin(o.model);
  if (mg && mg.length >= 7) add(idx.byGtin.get(mg));
  return out;
}
