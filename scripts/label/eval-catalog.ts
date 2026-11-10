/**
 * The label check against the whole recall list, measured in code: no model call, no network, no database.
 *
 *   npx tsx scripts/label/eval-catalog.ts        writes content/public/label-eval.json
 *
 * For every CPSC recall since 2024 that lists a model number (four or more letters and digits, with a digit: the
 * shortest code the matcher settles on) or a UPC, it builds the readings an owner's label would give and runs each
 * through the same path a real label takes after Claude has read it (checkReading in src/lib/label/check.ts: the
 * reading checks, then the catalog scan with Claude off):
 *
 *   model_brand      the brand and one model number, as on a rating label
 *   model_ocr        the same model as a reader might return it: spaces in place of dashes, dashes dropped, lower case
 *   upc              the UPC alone
 *   upc_no_zero      the UPC with its leading zero dropped (only for UPCs that start with 0)
 *
 * A positive is found when the check names that recall settled by its code: as the one match, or, when the same code is
 * in more than one recall's own list, among the recalls the owner is asked to pick from (counted apart, as shared).
 * The brand is the one a label would print, taken from the recall: its short firm name (scan-sample's brand), else the
 * first word of the firm's name. Negative controls must match no recall:
 *
 *   changed_model    each recall's model number with its digits changed (each digit d to (d + 3) mod 10), with the
 *                    brand, kept only when no recall's codes hold the changed code
 *   ordinary         a fixed list of everyday products with their brand and model number
 *
 * A negative "matches" when the answer is a match on any recall. Recalls close by name, which the page shows as
 * candidates to compare, are counted beside it. The in-app keyword search is used (Elastic is off here), so the run is
 * the same on every machine.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

for (const k of ["ELASTIC_URL", "ELASTIC_API_KEY", "DATABASE_URL", "ANTHROPIC_API_KEY"]) delete process.env[k];

import { checkReading, recallModels } from "../../src/lib/label/check";
import type { LabelReading } from "../../src/lib/label/schema";
import { codeOf, gtin, recallCodes } from "../../src/lib/recall/codes";
import { brand as brandOf } from "../../src/lib/recall/scan-sample";
import { loadRecalls } from "../../src/lib/recall/search";
import type { Recall } from "../../src/lib/recall/types";

export type Kind = "model_brand" | "model_ocr" | "upc" | "upc_no_zero" | "changed_model" | "ordinary";
export type Reading = { kind: Kind; recall: string | null; brand: string | null; product: string | null; model: string | null; upc: string | null };
export type Result = Reading & { outcome: string; got: string[]; found: boolean; shared: boolean };

/** Everyday products with their brand and model number: none is in a recall since January 2024 (the run checks). */
export const ORDINARY: { brand: string; product: string; model: string }[] = [
  { brand: "Logitech", product: "Wireless Mouse", model: "M185" },
  { brand: "Hamilton Beach", product: "Coffee Maker", model: "49980A" },
  { brand: "Cuisinart", product: "Coffeemaker", model: "DCC-3200" },
  { brand: "KitchenAid", product: "Stand Mixer", model: "KSM150PS" },
  { brand: "Philips Sonicare", product: "Electric Toothbrush", model: "HX6857" },
  { brand: "Brita", product: "Water Filter Pitcher", model: "OB03" },
  { brand: "Lenovo", product: "AC Adapter", model: "92P1154" },
  { brand: "Dell", product: "AC Adapter", model: "LA65NS2-01" },
  { brand: "Apple", product: "USB-C Power Adapter", model: "A2305" },
  { brand: "Panasonic", product: "AC Adapter", model: "RE7-87" },
  { brand: "Black+Decker", product: "Toaster Oven", model: "TO1313SBD" },
  { brand: "Oster", product: "Blender", model: "BLSTMB-CBG-000" },
  { brand: "Dyson", product: "Cordless Vacuum", model: "SV12" },
  { brand: "Shark", product: "Upright Vacuum", model: "NV352" },
  { brand: "Honeywell", product: "Tower Fan", model: "HYF290B" },
  { brand: "Lasko", product: "Box Fan", model: "B20200" },
  { brand: "Vornado", product: "Air Circulator", model: "660" },
  { brand: "Canon", product: "Battery Charger", model: "LC-E17" },
  { brand: "Nikon", product: "Battery Charger", model: "MH-25a" },
  { brand: "Sony", product: "Wireless Headphones", model: "WH-1000XM4" },
  { brand: "Bose", product: "Bluetooth Speaker", model: "SoundLink Flex" },
  { brand: "Fitbit", product: "Charging Cable", model: "FB507" },
  { brand: "Garmin", product: "Charging Cable", model: "010-12491-01" },
  { brand: "Netgear", product: "Wi-Fi Router", model: "R6700" },
  { brand: "TP-Link", product: "Smart Plug", model: "HS103" },
  { brand: "Greenfield Kitchen", product: "Bamboo cutting board", model: "GK-CB-1812" },
  { brand: "Linen Lane", product: "Cotton bath towel set", model: "LL-TWL-6" },
  { brand: "Harbor Pottery", product: "Stoneware coffee mug", model: "HP-MUG-12" },
];

/** A model number as a label reader might return it: spaces for dashes, dashes dropped, lower case. */
export function ocrVariants(m: string): string[] {
  const out = new Set([m.replace(/-/g, " "), m.replace(/[-\s]/g, ""), m.toLowerCase()]);
  out.delete(m);
  return [...out];
}

/** Each digit d to (d + 3) mod 10: the same shape of code, not the same code. */
export const changeDigits = (m: string) => m.replace(/\d/g, (d) => String((Number(d) + 3) % 10));

const modelCode = (m: string) => codeOf(m).length >= 4 && /\d/.test(codeOf(m));

/** The brand a label would print: the recall's short firm name, else the first word of the firm's name. */
export function labelBrand(r: Recall): string | null {
  const short = brandOf(r);
  if (short) return short;
  const first = (r.manufacturers[0] ?? "").split(/[\s,]+/)[0]?.replace(/[^\w&+.-]/g, "");
  return first && first.length >= 2 ? first : null;
}

/** The models and UPCs a recall lists, as the matcher can use them. */
export function listed(r: Recall): { models: string[]; shortModels: string[]; upcs: string[] } {
  const all = recallModels(r);
  const upcs = [...new Set(r.upcs.filter((u) => gtin(u)).concat([...recallCodes(r).upcs].filter((g) => !r.upcs.some((u) => gtin(u) === g))))];
  return { models: all.filter(modelCode), shortModels: all.filter((m) => !modelCode(m)), upcs };
}

/** The readings for one recall: positives from its own codes, and its changed-model negative. */
export function readingsFor(r: Recall, everyCode: Set<string>): Reading[] {
  const { models, upcs } = listed(r);
  const brand = labelBrand(r);
  const out: Reading[] = [];
  for (const m of models.slice(0, 3)) {
    out.push({ kind: "model_brand", recall: r.number, brand, product: null, model: m, upc: null });
    for (const v of ocrVariants(m)) out.push({ kind: "model_ocr", recall: r.number, brand, product: null, model: v, upc: null });
  }
  for (const u of upcs.slice(0, 3)) {
    out.push({ kind: "upc", recall: r.number, brand: null, product: null, model: null, upc: u });
    if (/^0\d+$/.test(u)) out.push({ kind: "upc_no_zero", recall: r.number, brand: null, product: null, model: null, upc: u.slice(1) });
  }
  const first = models.find((m) => /\d/.test(m));
  if (first) {
    const changed = changeDigits(first);
    if (changed !== first && !everyCode.has(codeOf(changed))) out.push({ kind: "changed_model", recall: null, brand, product: null, model: changed, upc: null });
  }
  return out;
}

/** The reading as Claude's structured output would carry it: each value read from its own line, with good confidence. */
export function asLabelReading(x: Reading): LabelReading {
  const f = (value: string | null, label: string) => ({ value, text_read: value ? `${label} ${value}` : null, confidence: value ? 0.9 : 0 });
  return {
    readable: true,
    brand: f(x.brand, ""),
    product_name: f(x.product, ""),
    model_numbers: x.model ? [f(x.model, "Model:")] : [],
    upc: f(x.upc, ""),
    lot_or_date: [],
    person: { visible: false, where: "" },
    retake_tip: "",
  };
}

export async function runOne(x: Reading): Promise<Result> {
  const c = await checkReading(asLabelReading(x));
  const got = c.matches.map((m) => m.number);
  const byCode = c.matches.filter((m) => m.matched_by !== "keywords").map((m) => m.number);
  const found = x.recall ? byCode.includes(x.recall) : c.outcome !== "match";
  return { ...x, outcome: c.outcome, got, found, shared: Boolean(x.recall) && found && byCode.length > 1 };
}

/** n readings; ok found (or, for a negative, matched no recall); candidates: answered with recalls to compare; shared: found among several recalls that list the same code. */
export type Tally = { n: number; ok: number; candidates: number; shared: number };
export type Eval = {
  note: string;
  ranAt: string;
  catalog: { recalls: number; withCodes: number; models: number; upcs: number; shortModelsOnly: number; search: string };
  positives: Tally & { byKind: Record<string, Tally>; missed: Result[] };
  negatives: Tally & { byKind: Record<string, Tally>; matched: Result[]; changedSkipped: number };
  sentence: string;
};

export async function measure(): Promise<Eval> {
  const recalls = loadRecalls();
  const everyCode = new Set<string>();
  for (const r of recalls) for (const c of recallCodes(r).models) everyCode.add(c);
  for (const r of recalls) for (const m of recallModels(r)) everyCode.add(codeOf(m));
  let withCodes = 0;
  let models = 0;
  let upcs = 0;
  let shortOnly = 0;
  let changedSkipped = 0;
  const readings: Reading[] = [];
  for (const r of recalls) {
    const l = listed(r);
    if (l.models.length || l.upcs.length) {
      withCodes++;
      models += Math.min(3, l.models.length);
      upcs += Math.min(3, l.upcs.length);
      const rs = readingsFor(r, everyCode);
      readings.push(...rs);
      if (l.models.length && !rs.some((x) => x.kind === "changed_model")) changedSkipped++;
    } else if (l.shortModels.length) shortOnly++;
  }
  for (const o of ORDINARY) readings.push({ kind: "ordinary", recall: null, brand: o.brand, product: o.product, model: o.model, upc: null });

  const results: Result[] = [];
  for (const x of readings) results.push(await runOne(x));
  const tally = (rs: Result[]): Tally => ({ n: rs.length, ok: rs.filter((r) => r.found).length, candidates: rs.filter((r) => r.outcome === "candidates").length, shared: rs.filter((r) => r.shared).length });
  const byKind = (rs: Result[]) => Object.fromEntries([...new Set(rs.map((r) => r.kind))].map((k) => [k, tally(rs.filter((r) => r.kind === k))]));
  const pos = results.filter((r) => r.recall);
  const neg = results.filter((r) => !r.recall);
  const p = tally(pos);
  const n = tally(neg);
  return {
    note: "The label check against every CPSC recall since January 2024 that lists a model number or UPC, measured in code with no model call: owner-style readings of each recall's own codes must find that recall, settled by code; negative controls (each recall's model with its digits changed, and everyday products) must match no recall. Written by scripts/label/eval-catalog.ts; tests/label-eval.test.ts runs it again.",
    ranAt: new Date().toISOString(),
    catalog: { recalls: recalls.length, withCodes, models, upcs, shortModelsOnly: shortOnly, search: "in-app keyword search (Elastic off), Claude off" },
    positives: { ...p, byKind: byKind(pos), missed: pos.filter((r) => !r.found) },
    negatives: { ...n, byKind: byKind(neg), matched: neg.filter((r) => !r.found), changedSkipped },
    sentence: `Found the right recall for ${p.ok.toLocaleString("en-US")} of ${p.n.toLocaleString("en-US")} label readings; ${n.ok.toLocaleString("en-US")} of ${n.n.toLocaleString("en-US")} not-recalled products matched no recall.`,
  };
}

/** The file without its run time, for comparing two runs. */
export const stable = (e: Eval) => ({ ...e, ranAt: undefined });

if (process.argv[1] && /eval-catalog\.ts$/.test(process.argv[1])) {
  const started = Date.now();
  measure()
    .then((e) => {
      writeFileSync(path.join(process.cwd(), "content", "public", "label-eval.json"), JSON.stringify(e, null, 2) + "\n");
      console.log(e.sentence);
      console.log(JSON.stringify({ catalog: e.catalog, positives: { ...e.positives, missed: e.positives.missed.length }, negatives: { ...e.negatives, matched: e.negatives.matched.length } }, null, 1));
      console.log(`${Date.now() - started} ms`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
