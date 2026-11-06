/**
 * A catalog CSV as scan items. Client-safe (the firm console parses the file in the browser before sending it).
 * Headers are matched loosely: name (or product, title, item, description), model (or model_number), sku (or upc,
 * barcode, ean), brand (or manufacturer, maker, firm). A file with no header is read as one product name per line.
 */
import Papa from "papaparse";
import type { ScanItem } from "./scan";

const KEYS: Record<keyof ScanItem, string[]> = {
  name: ["name", "product", "product_name", "productname", "title", "item", "item_name", "description", "listing"],
  model: ["model", "model_number", "modelnumber", "model_no", "models", "part", "part_number"],
  sku: ["sku", "upc", "barcode", "ean", "gtin", "asin", "item_number"],
  brand: ["brand", "manufacturer", "maker", "firm", "vendor", "make"],
};

/** When no header is an exact alias, one that contains these words is taken (product_title, model_no, upc_code). */
const LOOSE: Record<keyof ScanItem, RegExp> = { name: /name|title|product|item|description/, model: /model/, sku: /sku|upc|barcode|ean|gtin|asin/, brand: /brand|manufacturer|maker|vendor/ };

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

export function parseCatalogCsv(text: string, max = 500): { items: ScanItem[]; total: number; warnings: string[] } {
  const warnings: string[] = [];
  const src = text.replace(/^﻿/, "");
  if (!src.trim()) return { items: [], total: 0, warnings: ["The file is empty."] };
  const probe = Papa.parse<string[]>(src, { skipEmptyLines: true, preview: 1 });
  const head = (probe.data[0] ?? []).map(norm);
  const map: Partial<Record<keyof ScanItem, string>> = {};
  const taken = new Set<string>();
  for (const k of Object.keys(KEYS) as (keyof ScanItem)[]) {
    const col = head.find((h) => KEYS[k].includes(h) && !taken.has(h)) ?? head.find((h) => LOOSE[k].test(h) && !taken.has(h));
    if (col) {
      map[k] = col;
      taken.add(col);
    }
  }
  let items: ScanItem[] = [];
  let total = 0;
  if (map.name) {
    const parsed = Papa.parse<Record<string, string>>(src, { header: true, skipEmptyLines: true, transformHeader: norm });
    total = parsed.data.length;
    items = parsed.data.map((r) => ({ name: r[map.name!] ?? "", model: map.model ? r[map.model] : undefined, sku: map.sku ? r[map.sku] : undefined, brand: map.brand ? r[map.brand] : undefined })).filter((i) => i.name.trim());
    if (items.length < total) warnings.push(`${total - items.length} ${total - items.length === 1 ? "line has" : "lines have"} no product name and ${total - items.length === 1 ? "was" : "were"} left out.`);
  } else {
    // No recognizable header: each line is a product, with a second column read as the model.
    const parsed = Papa.parse<string[]>(src, { skipEmptyLines: true });
    total = parsed.data.length;
    items = parsed.data.map((r) => ({ name: r[0] ?? "", model: r[1] || undefined })).filter((i) => i.name.trim());
    warnings.push("No name column found, so each line was read as a product name (with a second column as the model).");
  }
  if (items.length > max) {
    warnings.push(`Only the first ${max} rows were kept; the file has ${items.length}.`);
    items = items.slice(0, max);
  }
  return { items, total, warnings };
}
