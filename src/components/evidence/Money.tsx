import value from "../../../content/recalls/value.json";
import { fmtInt } from "@/lib/api/format";
import type { RecallValue } from "@/lib/recall/value";
import { moneyWords } from "@/lib/recall/value";
import { PROBLEM, RESEARCH } from "@/lib/research";

/** What the made-safe refund recalls offer their owners, from content/recalls/value.json (scripts/recalls/value.ts). */
export const VALUE = value as RecallValue & { note: string; pulledAt: string };

/**
 * The money figures. What stays unclaimed is a range at two published rates that measure different things: about 6 in
 * 100 recalled units come back (the CPSC's 2017 workshop figure), and the CPSC's FY2025 average correction rate across
 * its recalls (44.55%, a method revised in FY2024). Both come from src/lib/research.ts through value.json.
 */
export function moneyHeadline() {
  return {
    total: moneyWords(VALUE.lowUsd),
    unclaimed: moneyWords(VALUE.unclaimedLowUsd),
    unclaimedAtCorrection: moneyWords(VALUE.unclaimedAtCorrectionLowUsd),
    range: `${moneyWords(VALUE.unclaimedAtCorrectionLowUsd)} to ${moneyWords(VALUE.unclaimedLowUsd)}`,
    perPoint: moneyWords(VALUE.perPointLowUsd),
    units: fmtInt(VALUE.units),
    covered: `${fmtInt(VALUE.covered)} of ${fmtInt(VALUE.recalls)}`,
    share: RESEARCH.comeBack.share,
    correctionRate: PROBLEM.correctionRate.rate,
    concentration: concentrationWords(),
  };
}

/**
 * How concentrated the total is, from value.json's `concentration` and `largest`: the two largest recalls' share and
 * the median recall. One sentence for the README, /evidence, /evidence/market and docs/results.md (tests/facts.test.ts).
 */
export function concentrationWords() {
  const c = VALUE.concentration;
  const [a, b] = VALUE.largest;
  return `The two largest recalls, ${a.number} and ${b.number}, are ${moneyWords(c.topTwoUsd)} of the ${moneyWords(VALUE.lowUsd)} (${c.topTwoShare.toFixed(1)}%), and the median recall offers ${moneyWords(c.medianUsd)}.`;
}

/** The money figures, each with what it counts; the unclaimed share as a range, each end with the rate it uses. */
export function Money() {
  const m = moneyHeadline();
  return (
    <dl className="ev-money">
      <div>
        <dt>{m.total}</dt>
        <dd>
          in refunds these recalls offer at the lowest stated price: <span className="tabular">{m.units}</span> units across the <span className="tabular">{m.covered}</span> recalls that refund a photo of the product made safe and whose CPSC
          record states both units and a price. <span className="tabular">{m.concentration}</span>
        </dd>
      </div>
      <div>
        <dt>{m.range}</dt>
        <dd>
          of those refunds stays unclaimed, at two published rates that measure different things: <span className="tabular">{m.unclaimedAtCorrection}</span> at the {m.correctionRate} the CPSC reports as its FY2025 average correction rate across
          recalls, measured by a method revised in FY2024; <span className="tabular">{m.unclaimed}</span> if about {m.share} recalled units come back, the CPSC&rsquo;s figure for how many products return after a recall.
        </dd>
      </div>
      <div>
        <dt>{m.perPoint}</dt>
        <dd>goes back to owners for each extra point of return, one more product in every 100.</dd>
      </div>
    </dl>
  );
}
