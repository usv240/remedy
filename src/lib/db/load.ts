/**
 * Turning the data builder's files (content/recalls/recalls.json and proof-rules.json) into rows. Pure functions, so
 * scripts/load-recalls.ts stays a thin loop and tests/load-recalls.test.ts can check every mapping without a database.
 * The input is read liberally (a string or a number of units, strings or { name } objects in lists), because the
 * files come from public data and another builder's normalizer.
 */
import type { RecallFlags, RecallImage, RecallProduct } from "./schema";

type Loose = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** "About 12,400" reads as 12400; "1.2 million" as 1200000; anything without a number as null. */
export function parseUnits(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const s = str(v).toLowerCase();
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(million|thousand)?/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = m[2] === "million" ? 1_000_000 : m[2] === "thousand" ? 1_000 : 1;
  const out = Math.round(n * mult);
  return out <= 2_000_000_000 ? out : null;
}

/** A date as YYYY-MM-DD from "2026-10-29", "2026-10-29T00:00:00" or a Date. Null when it cannot be read. */
export function isoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = str(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/** A list of names from strings or objects ({ name } or the CPSC API's { Name }). */
export function names(v: unknown): string[] {
  if (!Array.isArray(v)) return typeof v === "string" && v.trim() ? [v.trim()] : [];
  return v.map((x) => (typeof x === "string" ? x.trim() : x && typeof x === "object" ? str((x as Loose).name ?? (x as Loose).Name) : "")).filter(Boolean);
}

function products(v: unknown): RecallProduct[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is Loose => Boolean(p) && typeof p === "object")
    .map((p) => ({ name: str(p.name ?? p.Name), model: str(p.model ?? p.Model), description: str(p.description ?? p.Description), type: str(p.type ?? p.Type), units: str(p.units ?? p.NumberOfUnits) }));
}

function images(v: unknown): RecallImage[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((i) => (typeof i === "string" ? { url: i, caption: "" } : i && typeof i === "object" ? { url: str((i as Loose).url ?? (i as Loose).URL), caption: str((i as Loose).caption ?? (i as Loose).Caption) } : null))
    .filter((i): i is RecallImage => Boolean(i?.url));
}

function flags(v: unknown): RecallFlags {
  const f = (v && typeof v === "object" ? v : {}) as Loose;
  return { photo: f.photo === true, refund: f.refund === true, marker: f.marker === true, cut: f.cut === true, email: f.email === true, webmail: f.webmail === true };
}

export type RecallRow = {
  number: string;
  title: string;
  date: string;
  units: number | null;
  unitsText: string;
  hazard: string;
  remedyText: string;
  remedies: string[];
  products: RecallProduct[];
  images: RecallImage[];
  retailers: string[];
  manufacturers: string[];
  consumerContact: string;
  url: string;
  photoRefund: boolean;
  flags: RecallFlags;
};

/** One recall from recalls.json as a `recall` row, or null (with the reason) when it lacks a number, title or date. */
export function recallRow(r: unknown): { row: RecallRow } | { skip: string } {
  if (!r || typeof r !== "object") return { skip: "not an object" };
  const x = r as Loose;
  const number = str(x.number);
  const date = isoDate(x.date);
  if (!number) return { skip: "no recall number" };
  if (!str(x.title)) return { skip: `recall ${number} has no title` };
  if (!date) return { skip: `recall ${number} has no readable date` };
  const remedies = names(x.remedies);
  return {
    row: {
      number,
      title: str(x.title),
      date,
      units: parseUnits(x.units),
      unitsText: str(x.units),
      hazard: str(x.hazard),
      remedyText: str(x.remedyText) || remedies.join(" "),
      remedies,
      products: products(x.products),
      images: images(x.images),
      retailers: names(x.retailers),
      manufacturers: names(x.manufacturers),
      consumerContact: str(x.consumerContact),
      url: str(x.url),
      photoRefund: x.photoRefund === true,
      flags: flags(x.flags),
    },
  };
}

/** Image hashes from image-hashes.json ({ recallNumber: [{ url, dhash }] }) as `image_hash` rows, official source. */
export function officialHashRows(file: unknown): { source: "official"; ref: string; recallNumber: string; dhash: string }[] {
  if (!file || typeof file !== "object") return [];
  const out: { source: "official"; ref: string; recallNumber: string; dhash: string }[] = [];
  for (const [recallNumber, list] of Object.entries(file as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      const url = str((h as Loose)?.url);
      const dhash = str((h as Loose)?.dhash).toLowerCase();
      if (url && /^[0-9a-f]{16}$/.test(dhash)) out.push({ source: "official", ref: url, recallNumber, dhash });
    }
  }
  return out;
}

/** Split a list into chunks, for multi-row inserts. */
export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** JSON with object keys sorted, so two values compare equal however Postgres's jsonb ordered their keys. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** What to do with an extracted rule, given the latest stored version: insert v1, refresh the AI rule, or keep the firm's. */
export function ruleAction(latest: { source: string; version: number; rule: unknown } | null, rule: unknown): "insert" | "update" | "same" | "keep_firm" {
  if (!latest) return "insert";
  if (latest.source === "firm") return "keep_firm";
  return canonicalJson(latest.rule) === canonicalJson(rule) ? "same" : "update";
}
