/**
 * A small sample catalog for POST /api/v1/scan, built from real recalls in Remedy's data (so it never goes stale) plus
 * a few everyday items no recall since 2024 covers. Server only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadRecalls } from "./search";
import type { ScanItem } from "./scan";
import type { Recall } from "./types";

/** Everyday products that no CPSC recall since 2024 names: the "clear" rows. tests/recall-scan.test.ts keeps this true. */
export const CLEAR_ITEMS: ScanItem[] = [
  { name: "Bamboo cutting board, 18 by 12 inch", brand: "Greenfield Kitchen", sku: "GK-CB-1812" },
  { name: "Cotton bath towel set, 6 pieces", brand: "Linen Lane", model: "LL-TWL-6" },
  { name: "Stoneware coffee mug, 12 oz", brand: "Harbor Pottery", sku: "HP-MUG-12" },
];

const first = (r: Recall) => r.products.find((p) => p.name)?.name ?? r.title;
/** The first model code the recall states ("model number HD-1", "Models A100, A200"), from the CPSC's model field or the description. */
export const model = (r: Recall) => {
  const text = `${r.products.map((p) => `${p.model} ${p.description}`).join(" ")} ${r.description}`;
  const m = /\bmodel(?:\s+(?:number|no\.?|#))?s?\s*:?\s+(?:is\s+|are\s+)?([A-Z0-9][A-Z0-9./-]{2,}\d[A-Z0-9./-]*)/i.exec(text)?.[1] ?? "";
  const code = m.replace(/[.,;:]+$/, "");
  return code.length >= 4 && code.length <= 40 ? code : "";
};
/** The firm as a catalog would write it: the name before any comma, "dba" or "of <place>", when it is short. */
export const brand = (r: Recall) => {
  const raw = r.manufacturers[0] ?? "";
  const short = raw.split(/,| dba | doing business as | of /i)[0].trim();
  return short && short.split(/\s+/).length <= 3 ? short : "";
};

function itemFrom(r: Recall, withModel: boolean): ScanItem {
  const m = withModel ? model(r) : "";
  const b = brand(r);
  return { name: first(r).slice(0, 120), brand: b || undefined, model: m || undefined };
}

/**
 * The demo recalls, two more recent photo-refund recalls, the newest recall that offers a repair or replacement
 * instead, and three clear items.
 */
export function sampleCatalog(): { note: string; items: ScanItem[] } {
  const all = loadRecalls();
  let picks: string[] = [];
  try {
    picks = (JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "demo-picks.json"), "utf8")) as { picks?: { number: string }[] }).picks?.map((p) => p.number) ?? [];
  } catch {
    picks = [];
  }
  const by = new Map(all.map((r) => [r.number, r]));
  const chosen: Recall[] = picks.map((n) => by.get(n)).filter((r): r is Recall => Boolean(r));
  for (const r of all) {
    if (chosen.length >= 5) break;
    if (r.photoRefund && !chosen.includes(r) && model(r)) chosen.push(r);
  }
  const other = all.find((r) => !r.photoRefund && !r.flags.photo && (r.remedies.includes("Repair") || r.remedies.includes("Replace")) && model(r));
  const items: ScanItem[] = [...chosen.map((r, i) => itemFrom(r, i % 2 === 0)), ...(other ? [itemFrom(other, true)] : []), ...CLEAR_ITEMS];
  return {
    note: "A sample catalog: real CPSC recalls from Remedy's data (public domain) and three everyday items no recall covers. Send it to POST /api/v1/scan as { items }.",
    items,
  };
}
