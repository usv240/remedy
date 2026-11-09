/**
 * The headline counts and the money, from the CPSC records and the proof rules: writes content/recalls/proof-split.json
 * (what each photo-refund recall's photo is for, src/lib/recall/made-safe.ts) and content/recalls/value.json (what the
 * made-safe refund recalls offer their owners, src/lib/recall/value.ts). Free: reads content/recalls/recalls.json and
 * content/recalls/proof-rules.json, calls nothing. tests/recall-value.test.ts recomputes both files.
 *
 *   npx tsx scripts/recalls/value.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { proofSplit, type SplitRecall, type SplitRule } from "../../src/lib/recall/made-safe";
import { moneyWords, recallValue, type ValueRecall } from "../../src/lib/recall/value";

const dir = path.join(process.cwd(), "content", "recalls");
const data = JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as { pulledAt: string; range: { from: string; to: string }; recalls: (ValueRecall & SplitRecall)[] };
const rules = (JSON.parse(readFileSync(path.join(dir, "proof-rules.json"), "utf8")) as { rules: Record<string, SplitRule> }).rules;

const split = proofSplit(data.recalls, rules);
writeFileSync(
  path.join(dir, "proof-split.json"),
  JSON.stringify(
    {
      note: "Written by scripts/recalls/value.ts from content/recalls/recalls.json and content/recalls/proof-rules.json. A recall is photo-refund when its remedy text names a photo and a refund (src/lib/recall/classify.ts); its proof rule then says what the photo must show and what the owner gets (src/lib/recall/made-safe.ts). The headline is madeSafeRefund: a photo of the product made safe, and a refund in money.",
      pulledAt: data.pulledAt,
      range: data.range,
      ...split,
    },
    null,
    1,
  ) + "\n",
);

const v = recallValue(data.recalls, rules);
writeFileSync(
  path.join(dir, "value.json"),
  JSON.stringify(
    {
      note: "Written by scripts/recalls/value.ts from content/recalls/recalls.json (CPSC Recalls API) and content/recalls/proof-rules.json. Only the recalls whose rule asks for a photo of the product made safe and pays a refund in money count. Each is its US units times the refund for one unit: the lowest sale price its record states in the Sold At line, or the fixed amount its rule states when that is lower. Pro-rated refunds state no share of the price and are left out, as are recalls that state no units or no price; nothing is estimated. The unclaimed figure is given at two published rates that measure different things: 'comeBackShare' is the CPSC's measure that about 6 in 100 recalled units come back, and 'correctionRate' is the CPSC's FY2025 average correction rate across recalls (44.55%, a method revised in FY2024), both from src/lib/research.ts.",
      pulledAt: data.pulledAt,
      ...v,
    },
    null,
    1,
  ) + "\n",
);

console.log(
  `split: ${split.photoRefund} photo-refund recalls; ${split.madeSafe} ask for a photo made safe (${split.madeSafeRefund.count} pay a refund, ${split.madeSafeCredit.count} store credit); ${split.otherPhoto.count} a photo for another reason (${split.otherPhoto.product} the product, ${split.otherPhoto.identifier.count} a label or code); ${split.noPhoto.count} no photo.`,
);
console.log(
  `value: ${v.covered} of ${v.recalls} counted (${v.proRated.count} pro-rated, ${v.noPrice} no price); ${v.units.toLocaleString("en-US")} units; ${moneyWords(v.lowUsd)} at the lowest stated price (${moneyWords(v.highUsd)} at the highest); ${moneyWords(v.unclaimedLowUsd)} unclaimed at 6 in 100 and ${moneyWords(v.unclaimedAtCorrectionLowUsd)} at the ${(v.correctionRate * 100).toFixed(2)}% correction rate; ${moneyWords(v.perPointLowUsd)} per point.`,
);
