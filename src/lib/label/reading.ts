/**
 * A label reading, checked by code before anything is looked up. Pure, so the page, the API, the MCP tool and the
 * tests share it. Claude reads the label (src/lib/label/read.ts); this file decides which of what it read may be
 * searched by:
 *
 *   - A field counts only when its value is found inside the text it says it read it from (letters and digits, case
 *     ignored). A value that is not in its own line was not read from the label, so it is set aside, never searched.
 *   - A field read with a confidence under MIN_CONFIDENCE is shown but not searched by.
 *   - A UPC is digits only, 6 to 14 of them; its check digit is reported, never used to drop it.
 *   - A person in the photo: the reading is not used, and the owner is asked for a photo of the label alone.
 */
import { codeOf, gtin, gtinCheckOk } from "@/lib/recall/codes";
import type { LabelField, LabelReading } from "./schema";

/** Below this, a field is shown to the owner but never searched by. */
export const MIN_CONFIDENCE = 0.4;
/** Model numbers searched from one label, at most. */
export const MAX_MODELS = 4;

export type ReadField = {
  value: string;
  text_read: string | null;
  confidence: number;
  /** The value appears in the text it was read from, and its confidence is at least MIN_CONFIDENCE. */
  used: boolean;
  /** Why a field is not used, in plain words; null when it is. */
  set_aside: string | null;
};

export type ReadLabel = {
  readable: boolean;
  brand: ReadField | null;
  product: ReadField | null;
  models: ReadField[];
  upc: (ReadField & { digits: string; check_digit_ok: boolean }) | null;
  lots: (ReadField & { kind: LabelReading["lot_or_date"][number]["kind"] })[];
  person: { where: string } | null;
  retake_tip: string;
  /** Something can be searched by: a model, a UPC, or the brand or product name. */
  searchable: boolean;
};

const clamp = (n: unknown) => Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));
const tidy = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** One field, checked: null when nothing was read. */
export function readField(f: LabelField | null | undefined, opts: { code?: boolean } = {}): ReadField | null {
  const value = tidy(f?.value).slice(0, 120);
  if (!value) return null;
  const text = tidy(f?.text_read).slice(0, 240) || null;
  const confidence = Math.round(clamp(f?.confidence) * 100) / 100;
  const inLine = Boolean(text) && codeOf(text).includes(codeOf(value)) && codeOf(value).length > 0;
  const set_aside = !inLine
    ? `Not in the line it was read from${text ? ` ("${text}")` : ""}, so it is not used.`
    : confidence < MIN_CONFIDENCE
      ? `Read with low confidence (${confidence.toFixed(2)}), so it is not used.`
      : opts.code && codeOf(value).length < 2
        ? "Too short to look up."
        : null;
  return { value, text_read: text, confidence, used: set_aside === null, set_aside };
}

/** The reading as code uses it. */
export function readLabelFields(r: LabelReading): ReadLabel {
  const brand = readField(r.brand);
  const product = readField(r.product_name);
  const seen = new Set<string>();
  const models = (r.model_numbers ?? [])
    .map((m) => readField(m, { code: true }))
    .filter((m): m is ReadField => m !== null)
    .filter((m) => {
      const k = codeOf(m.value);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
  const u = readField(r.upc, { code: true });
  const digits = u ? u.value.replace(/\D/g, "") : "";
  const upc = u
    ? (() => {
        const ok = Boolean(gtin(u.value)) && /^[\d\s-]+$/.test(u.value);
        const field = ok ? u : { ...u, used: false, set_aside: u.set_aside ?? "Not a UPC: a UPC is 6 to 14 digits." };
        return { ...field, digits, check_digit_ok: ok && gtinCheckOk(digits) };
      })()
    : null;
  const lots = (r.lot_or_date ?? [])
    .map((l) => {
      const f = readField(l);
      return f ? { ...f, kind: l.kind } : null;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .slice(0, 6);
  const person = r.person?.visible ? { where: tidy(r.person.where).slice(0, 200) } : null;
  const searchable = models.some((m) => m.used) || Boolean(upc?.used) || Boolean(brand?.used) || Boolean(product?.used);
  return { readable: Boolean(r.readable), brand, product, models, upc, lots, person, retake_tip: tidy(r.retake_tip).slice(0, 240), searchable };
}

/** What the owner can search by name when no recall lists the label's codes: the brand and the product. */
export function nameQuery(l: ReadLabel): string {
  return [l.brand?.used ? l.brand.value : "", l.product?.used ? l.product.value : ""].filter(Boolean).join(" ").slice(0, 80);
}

/** The label's codes as a short phrase: "model KC101B", "models A and B", "UPC 400000652009". */
export function codesPhrase(l: ReadLabel): string {
  const models = l.models.filter((m) => m.used).map((m) => m.value);
  const parts: string[] = [];
  if (models.length) parts.push(`${models.length === 1 ? "model" : "models"} ${models.length <= 2 ? models.join(" and ") : `${models.slice(0, -1).join(", ")} and ${models.at(-1)}`}`);
  if (l.upc?.used) parts.push(`UPC ${l.upc.digits}`);
  return parts.join(" or ");
}
