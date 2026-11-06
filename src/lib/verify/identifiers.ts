import type { IdentifierRange, VerifyRecall } from "./types";

/**
 * Model numbers, lot ranges and date codes: read from recall text and compared with what the photo shows (C4).
 * Pure string work, no model calls.
 */

/** Uppercase letters and digits only: "dr-hsh015" and "DR HSH015" both become "DRHSH015". */
export function normalizeId(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const PREFIX = /^\s*(?:model|mod\.?|m\/n|item|lot|batch|serial|s\/n|date(?:\s*code)?|mfg\.?(?:\s*date)?)\s*(?:number|no\.?|#|code)?\s*[:#.]?\s*/i;
const QUOTES = /[“”"'‘’]/g;

/** Strip a leading label such as "Model:" or "Lot No." that the reader may include. */
export function stripLabel(s: string): string {
  return s.replace(QUOTES, "").replace(PREFIX, "").trim();
}

function isModelToken(t: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/.]*$/.test(t)) return false;
  return /\d/.test(t) || /^[A-Z]{2,}$/.test(t);
}

/**
 * Model numbers named in recall text: what follows "model", "models", "model number(s)" or "model no.", split on
 * commas, "and" and "or". A model must contain a digit; a plain uppercase word can extend one ("W5 PRO").
 */
export function extractModels(text: string): string[] {
  const out = new Set<string>();
  const re = /\bmodels?(?:\s+(?:numbers?|nos?\.?|#))?\s*[:#]?\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let span = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const end = span.search(/\.(?:\s|$)|\n/);
    if (end >= 0) span = span.slice(0, end);
    for (const part of span.split(/,|;|\band\b|\bor\b|&/i)) {
      const tokens = part.replace(QUOTES, " ").trim().split(/\s+/);
      const kept: string[] = [];
      for (const t of tokens) {
        if (!t || !isModelToken(t.replace(/[.)]+$/, ""))) break;
        kept.push(t.replace(/[.)]+$/, ""));
      }
      const model = kept.join(" ");
      if (/\d/.test(model) && model.length >= 2 && model.length <= 30) out.add(model);
    }
  }
  return [...out];
}

/** Every model this recall covers: the given list, or what its title, description and products name. */
export function knownModels(recall: VerifyRecall): string[] {
  if (recall.models?.length) return [...new Set(recall.models.map((x) => x.trim()).filter(Boolean))];
  const text = [recall.title, recall.description ?? "", ...recall.products.flatMap((p) => [p.name, p.model ?? "", p.description ?? ""])].join(". ");
  const found = new Set(extractModels(text));
  for (const p of recall.products) if (p.model && /\d/.test(p.model)) for (const x of p.model.split(/[,;]/)) if (x.trim()) found.add(stripLabel(x));
  return [...found];
}

export type ModelMatch = { model: string; exact: boolean } | null;

/**
 * Does the model read from the photo name a recalled model? Exact after normalizing, or the recalled model plus a short
 * variant suffix of up to 3 characters (a color code, for example "DR-HSH015B").
 */
export function matchModel(read: string, models: readonly string[]): ModelMatch {
  const r = normalizeId(stripLabel(read));
  if (r.length < 2) return null;
  for (const m of models) if (normalizeId(m) === r) return { model: m, exact: true };
  for (const m of models) {
    const n = normalizeId(m);
    if (n.length >= 4 && r.startsWith(n) && r.length - n.length <= 3) return { model: m, exact: false };
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_WORD = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\\.?";
const monthIndex = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase());
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/** A date code as YYYY-MM, or null when it is not a recognisable year and month. */
export function normalizeDateCode(raw: string): string | null {
  const s = stripLabel(raw).trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^((?:19|20)\d{2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*\d{1,2})?$/))) return +m[2] >= 1 && +m[2] <= 12 ? ym(+m[1], +m[2]) : null;
  if ((m = s.match(/^(\d{1,2})\s*[/.-]\s*((?:19|20)\d{2})$/))) return +m[1] >= 1 && +m[1] <= 12 ? ym(+m[2], +m[1]) : null;
  if ((m = s.match(/^((?:19|20)\d{2})(\d{2})(\d{2})?$/))) return +m[2] >= 1 && +m[2] <= 12 ? ym(+m[1], +m[2]) : null;
  if ((m = s.match(new RegExp(`^${MONTH_WORD}\\s*,?\\s*((?:19|20)\\d{2})$`, "i")))) return ym(+m[2], monthIndex(m[1]) + 1);
  return null;
}

/**
 * Lot, serial and date ranges named in recall text. Month ranges count only in a sentence about manufacture or date
 * codes, so a "sold from ... through ..." window is never read as a production range.
 */
export function extractRanges(text: string): IdentifierRange[] {
  const out: IdentifierRange[] = [];
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (/manufactur|produc|made\b|date code|build date|mfg/i.test(sentence)) {
      const re = new RegExp(`${MONTH_WORD}\\s*,?\\s*((?:19|20)\\d{2})\\s+(?:through|to|until|and|-)\\s+${MONTH_WORD}\\s*,?\\s*((?:19|20)\\d{2})`, "gi");
      for (const m of sentence.matchAll(re)) {
        out.push({ kind: "date_code", from: ym(+m[2], monthIndex(m[1]) + 1), to: ym(+m[4], monthIndex(m[3]) + 1), source: m[0] });
      }
    }
  }
  const generic: [IdentifierRange["kind"], RegExp][] = [
    ["date_code", /\bdate codes?\s*(?:from\s+|between\s+)?([A-Z0-9/.-]{3,})\s+(?:through|to|and|-)\s+([A-Z0-9/.-]{3,})/gi],
    ["lot", /\b(?:lot|batch)\s*(?:numbers?|codes?|nos?\.?|#)?\s*(?:from\s+|between\s+)?([A-Z0-9-]{3,})\s+(?:through|to|and|-)\s+([A-Z0-9-]{3,})/gi],
    ["serial", /\bserial\s*(?:numbers?|nos?\.?|#)?\s*(?:from\s+|between\s+)?([A-Z0-9-]{3,})\s+(?:through|to|and|-)\s+([A-Z0-9-]{3,})/gi],
  ];
  for (const [kind, re] of generic) {
    for (const m of text.matchAll(re)) {
      if (!/\d/.test(m[1]) || !/\d/.test(m[2])) continue;
      const clean = (s: string) => s.replace(/[.,;]+$/, "");
      out.push({ kind, from: clean(m[1]), to: clean(m[2]), source: m[0] });
    }
  }
  return out;
}

export function knownRanges(recall: VerifyRecall): IdentifierRange[] {
  if (recall.ranges?.length) return recall.ranges;
  return extractRanges([recall.description ?? "", ...recall.products.map((p) => p.description ?? "")].join(" "));
}

/**
 * Is a value read from the photo inside a range? true or false when the two can be compared; null when they cannot
 * (different formats), so the caller can treat it as unclear rather than guess.
 */
export function inRange(read: string, range: IdentifierRange): boolean | null {
  const fromDate = normalizeDateCode(range.from);
  const toDate = normalizeDateCode(range.to);
  if (fromDate && toDate) {
    const d = normalizeDateCode(read);
    if (!d) return null;
    return d >= fromDate && d <= toDate;
  }
  const a = normalizeId(stripLabel(read));
  const f = normalizeId(range.from);
  const t = normalizeId(range.to);
  if (!a || !f || !t) return null;
  if (/^\d+$/.test(a) && /^\d+$/.test(f) && /^\d+$/.test(t)) {
    const [x, lo, hi] = [BigInt(a), BigInt(f), BigInt(t)];
    return x >= lo && x <= hi;
  }
  if (a.length === f.length && f.length === t.length) return a >= f && a <= t;
  return null;
}

/** US units from CPSC's text ("About 29,000 (In addition, about 4,500 were sold in Canada)" gives 29000). */
export function parseUnits(units: number | string | null | undefined): number | null {
  if (typeof units === "number") return Number.isFinite(units) && units > 0 ? Math.floor(units) : null;
  if (!units) return null;
  const m = units.match(/(\d[\d,]*(?:\.\d+)?)\s*(million|thousand)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  const mult = m[2]?.toLowerCase() === "million" ? 1_000_000 : m[2]?.toLowerCase() === "thousand" ? 1000 : 1;
  return n > 0 ? Math.round(n * mult) : null;
}
