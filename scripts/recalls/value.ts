/**
 * What the photo-refund recalls are worth to their owners, from the CPSC records: writes content/recalls/value.json.
 * Units times the lowest sale price each record states, only where the record states both (src/lib/recall/value.ts).
 * Free: reads content/recalls/recalls.json, calls nothing.
 *
 *   npx tsx scripts/recalls/value.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { moneyWords, recallValue, type ValueRecall } from "../../src/lib/recall/value";

const dir = path.join(process.cwd(), "content", "recalls");
const data = JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as { pulledAt: string; recalls: ValueRecall[] };
const v = recallValue(data.recalls);
const out = {
  note: "Written by scripts/recalls/value.ts from content/recalls/recalls.json (CPSC Recalls API). Each photo-refund recall's US units times the sale price its record states in the Sold At line; a range is taken at its lowest price. Recalls that state no price are left out, not estimated. 'comeBackShare' is the CPSC's measure that about 6 in 100 recalled products come back (src/lib/research.ts).",
  pulledAt: data.pulledAt,
  ...v,
};
writeFileSync(path.join(dir, "value.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`value: ${v.covered} of ${v.recalls} photo-refund recalls state units and a price; ${v.units.toLocaleString("en-US")} units; ${moneyWords(v.lowUsd)} at the lowest stated price (${moneyWords(v.highUsd)} at the highest); ${moneyWords(v.unclaimedLowUsd)} unclaimed at 6 in 100; ${moneyWords(v.perPointLowUsd)} per point.`);
