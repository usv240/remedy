/**
 * Counts how many records in the CPSC's full recall listing (every recall since 1973) name a payment rail or an
 * electronic refund, and writes the counts, never the CSV, to content/recalls/listing-mentions.json.
 *
 *   npx tsx scripts/recalls/listing-mentions.ts <path-to-recalls_recall_listing.csv>
 *   npx tsx scripts/recalls/listing-mentions.ts            downloads the CSV from LISTING_URL first
 *
 * The CSV is 17 MB and is not committed; the JSON records its URL and the date it was read. A record counts for a
 * term when the term appears, in any case, in any of its fields. src/lib/research.ts reads the JSON.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";

export const LISTING_URL = "https://www.cpsc.gov/s3fs-public/recall-data/recalls_recall_listing.csv";
const OUT = path.join(process.cwd(), "content", "recalls", "listing-mentions.json");

/** Each term as a whole word or phrase, in any case. */
export const TERMS: Record<string, RegExp> = {
  paypal: /\bpaypal\b/i,
  venmo: /\bvenmo\b/i,
  electronicPayment: /\belectronic payment\b/i,
  virtualCard: /\bvirtual (?:prepaid )?(?:gift card|card|mastercard|visa)\b/i,
};

export type Mentions = { records: number; terms: Record<string, { count: number; recallNumbers: string[] }> };

/** Counts the records whose fields name each term. Pure: takes the CSV text. */
export function countMentions(csv: string): Mentions {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  const rows = parsed.data.filter((r) => Object.values(r).some((v) => v && v.trim()));
  const terms: Mentions["terms"] = Object.fromEntries(Object.keys(TERMS).map((k) => [k, { count: 0, recallNumbers: [] }]));
  for (const row of rows) {
    const text = Object.values(row).join("\n");
    for (const [k, re] of Object.entries(TERMS)) {
      if (re.test(text)) {
        terms[k].count++;
        terms[k].recallNumbers.push(row["Recall Number"] || row["Product Safety Warning Number"] || "?");
      }
    }
  }
  return { records: rows.length, terms };
}

async function main() {
  const arg = process.argv[2];
  let csv: string;
  if (arg && existsSync(arg)) csv = readFileSync(arg, "utf8");
  else {
    const res = await fetch(LISTING_URL);
    if (!res.ok) throw new Error(`${LISTING_URL}: HTTP ${res.status}`);
    csv = await res.text();
  }
  const m = countMentions(csv);
  const dates = [...csv.matchAll(/"([A-Z][a-z]+ \d{1,2}, \d{4})"/g)].map((x) => new Date(x[1])).filter((d) => !Number.isNaN(d.getTime()));
  const latest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10) : null;
  const out = {
    note: "Written by scripts/recalls/listing-mentions.ts from the CPSC's full recall listing CSV (every recall since 1973). The CSV is not committed; a record counts for a term when the term appears in any of its fields. src/lib/research.ts reads this file.",
    source: LISTING_URL,
    readAt: new Date().toISOString().slice(0, 10),
    latestRecallDate: latest,
    records: m.records,
    terms: m.terms,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`${m.records} records; ${Object.entries(m.terms).map(([k, v]) => `${k} ${v.count}`).join(", ")}; latest recall ${latest}`);
}

if (process.argv[1] && /listing-mentions\.ts$/.test(process.argv[1])) void main();
