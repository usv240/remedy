import value from "../../../content/recalls/value.json";
import { fmtInt } from "@/lib/api/format";
import type { RecallValue } from "@/lib/recall/value";
import { moneyWords } from "@/lib/recall/value";
import { RESEARCH } from "@/lib/research";

/** What the made-safe refund recalls offer their owners, from content/recalls/value.json (scripts/recalls/value.ts). */
export const VALUE = value as RecallValue & { note: string; pulledAt: string };

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
          in refunds these recalls offer at the lowest stated price: <span className="tabular">{m.units}</span> units across the <span className="tabular">{m.covered}</span> recalls that refund a photo of the product made safe and whose CPSC
          record states both units and a price.
        </dd>
      </div>
      <div>
        <dt>{m.unclaimed}</dt>
        <dd>of those refunds stays unclaimed if these recalls see the CPSC&rsquo;s average of about {m.share} products come back.</dd>
      </div>
      <div>
        <dt>{m.perPoint}</dt>
        <dd>goes back to owners for each extra point of return, one more product in every 100.</dd>
      </div>
    </dl>
  );
}
