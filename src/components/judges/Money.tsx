import value from "../../../content/recalls/value.json";
import { fmtInt } from "@/lib/api/format";
import { moneyWords } from "@/lib/recall/value";
import { RESEARCH } from "@/lib/research";

/** What the photo-refund recalls are worth to their owners, from content/recalls/value.json (scripts/recalls/value.ts). */
export const VALUE = value as { recalls: number; covered: number; units: number; lowUsd: number; highUsd: number; comeBackShare: number; unclaimedLowUsd: number; perPointLowUsd: number; largest: { number: string; units: number; price: number; usd: number }[] };

export function moneyHeadline() {
  return {
    total: moneyWords(VALUE.lowUsd),
    unclaimed: moneyWords(VALUE.unclaimedLowUsd),
    perPoint: moneyWords(VALUE.perPointLowUsd),
    units: fmtInt(VALUE.units),
    covered: `${fmtInt(VALUE.covered)} of ${fmtInt(VALUE.recalls)}`,
    share: RESEARCH.comeBack.share,
  };
}

/** The three money figures, each with what it counts. */
export function Money() {
  const m = moneyHeadline();
  return (
    <dl className="ev-money">
      <div>
        <dt>{m.total}</dt>
        <dd>
          the recalled products are worth at their lowest stated price: <span className="tabular">{m.units}</span> units across the <span className="tabular">{m.covered}</span> photo-refund recalls whose CPSC record states both units and a price.
        </dd>
      </div>
      <div>
        <dt>{m.unclaimed}</dt>
        <dd>of these products stays in homes unclaimed if these recalls see the CPSC&rsquo;s average of about {m.share} products come back.</dd>
      </div>
      <div>
        <dt>{m.perPoint}</dt>
        <dd>goes back to owners in refunds or replacements for each extra point of return, one more product in every 100.</dd>
      </div>
    </dl>
  );
}
