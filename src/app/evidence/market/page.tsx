import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { Adoption, Pilot } from "@/components/judges/Adoption";
import { Compare } from "@/components/judges/Compare";
import { Money, VALUE } from "@/components/judges/Money";
import { fmtInt } from "@/lib/api/format";
import { storedRule } from "@/lib/api/recall-data";
import { SPLIT } from "@/lib/recall/headline";
import { moneyWords } from "@/lib/recall/value";
import "../../pages.css";
import "../../landing-shared.css";
import "../evidence.css";

export const metadata: Metadata = { title: "Stake and adoption", description: "What the recalls that refund a made-safe photo offer their owners, how Remedy compares with claim portals, and who runs it first." };

/** A large recall whose rule states a fixed refund above its lowest price: it counts at that price. */
function cappedExample() {
  for (const r of VALUE.largest) {
    const rule = storedRule(r.number)?.rule;
    if (rule?.refund_amount && rule.refund_amount > r.price && rule.refund_amount_text) return { number: r.number, text: rule.refund_amount_text, price: r.price };
  }
  return null;
}
const capped = cappedExample();

/** /evidence/market: the money method, the comparison and the adoption plan, moved off /evidence to keep it short. */
export default function MarketPage() {
  return (
    <div className="page frame evidence">
      <OpenOnHash />
      <header className="page-head">
        <p className="ev-back">
          <Link className="text-link" href="/evidence#more">
            Evidence
          </Link>
        </p>
        <h1 className="page-title">What is at stake, and who runs it first</h1>
        <p className="lede">What the recalls that refund a photo of the product made safe offer their owners, how a claim works today, and the three groups that can run Remedy as it is.</p>
      </header>

      <section id="money" className="page-section" aria-labelledby="money-h">
        <div className="title-row">
          <h2 id="money-h">What the recalls are worth to their owners</h2>
          <Info id="evidence.money" label="" topic="What is at stake" />
        </div>
        <Money />
        <p className="page-prose">
          The method: for each of the {fmtInt(VALUE.recalls)} recalls whose proof rule asks for a photo of the product made safe and pays a refund in money, its US units times the refund for one unit. That is the lowest sale price its CPSC record states in the Sold
          At field, or the fixed refund its rule states when that is lower ({fmtInt(VALUE.atStatedAmount.count)} recalls). {fmtInt(VALUE.covered)} records state units and a price. {fmtInt(VALUE.proRated.count)} pro-rated refunds ({VALUE.proRated.numbers.join(", ")}) state no share of the
          price and {fmtInt(VALUE.noPrice)} records state no price, so those {fmtInt(VALUE.recalls - VALUE.covered)} are left out, not estimated. At the highest stated prices the same refunds come to {moneyWords(VALUE.highUsd)}. The 6 in 100 is an average across consumer
          product recalls, not a measure of these recalls in particular.
        </p>
        <div className="jb-wrap" role="region" aria-label="The largest recalls by value" tabIndex={0}>
          <table className="jb">
            <caption className="sr-only">The five largest made-safe refund recalls by units times the refund counted for one unit</caption>
            <thead>
              <tr>
                <th scope="col">Recall</th>
                <th scope="col">The rule&rsquo;s refund</th>
                <th scope="col">US units</th>
                <th scope="col">Counted for one unit</th>
                <th scope="col">Units times that</th>
              </tr>
            </thead>
            <tbody>
              {VALUE.largest.map((r) => (
                <tr key={r.number}>
                  <th scope="row">
                    <Link className="text-link" href={`/recalls/${r.number}`}>
                      {r.number}
                    </Link>
                  </th>
                  <td>{storedRule(r.number)?.rule.refund_amount_text ?? "a refund"}</td>
                  <td className="jb-num tabular">{fmtInt(r.units)}</td>
                  <td className="jb-num tabular">${r.price.toFixed(2)}</td>
                  <td className="jb-num tabular">${fmtInt(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="page-note">
          {capped ? `A stated refund above the lowest price counts at that price, so the figure stays a floor: ${capped.number} states ${capped.text}, more than its lowest stated price, and counts at $${capped.price.toFixed(2)}. ` : ""}Written by
          scripts/recalls/value.ts to content/recalls/value.json from the CPSC Recalls API pull and the proof rules; tests/recall-value.test.ts recomputes it.
        </p>
      </section>

      <section id="photo-asks" className="page-section" aria-labelledby="asks-h">
        <h2 id="asks-h">What each photo is for</h2>
        <p className="page-prose">
          {fmtInt(SPLIT.photoRefund)} recalls since 2024 name a photo and a refund in their remedy. Their proof rules say what the photo must show, and that is what the headline counts:
        </p>
        <ul className="ev-rules">
          <li>
            <strong className="tabular">{fmtInt(SPLIT.madeSafe)}</strong> ask for a photo of the product made safe: {fmtInt(SPLIT.madeSafeRefund.count)} pay a refund for it, the headline, and {fmtInt(SPLIT.madeSafeCredit.count)} pay store credit or a gift card ({SPLIT.madeSafeCredit.numbers.join(", ")}).
          </li>
          <li>
            <strong className="tabular">{fmtInt(SPLIT.otherPhoto.count)}</strong> ask for a photo for another reason: {fmtInt(SPLIT.otherPhoto.product)} of the product itself, as proof of ownership, and {fmtInt(SPLIT.otherPhoto.identifier.count)} of a label, lot or date code (
            {SPLIT.otherPhoto.identifier.numbers.join(", ")}).
          </li>
          <li>
            <strong className="tabular">{fmtInt(SPLIT.noPhoto.count)}</strong> need no photo once read closely ({SPLIT.noPhoto.numbers.join(", ")}): the photo is one proof of purchase among others, or the owner visits a store.
          </li>
        </ul>
        <p className="page-prose">
          The {fmtInt(SPLIT.otherPhoto.count)} still fit Remedy&rsquo;s checks. Right product compares the photo with the recall&rsquo;s own pictures, Your own photo keeps out a copied or already-claimed picture, and Made safe passes because the rule asks for no
          change (evaluateC2 in src/lib/verify/checks.ts). For the {fmtInt(SPLIT.otherPhoto.identifier.count)} that ask for a label, lot or date code, Within the recall reads the code from the photo and compares it with the range the recall states (evaluateC4 and
          src/lib/verify/identifiers.ts). They are counted apart because a photo of the product as it is proves ownership, while a photo of it made safe also proves it is out of use.
        </p>
        <p className="page-note">Written by scripts/recalls/value.ts to content/recalls/proof-split.json from the recalls and their proof rules (src/lib/recall/made-safe.ts); tests/recall-value.test.ts recomputes it.</p>
      </section>

      <section id="compare" className="page-section" aria-labelledby="cmp-h">
        <div className="title-row">
          <h2 id="cmp-h">How it compares</h2>
          <Info id="evidence.compare" label="" topic="How it compares" />
        </div>
        <p className="page-prose jp-intro">Each of these does its job. Remedy adds the instant check and the PayPal payout to what firms already do.</p>
        <Compare />
      </section>

      <section id="adoption" className="page-section" aria-labelledby="ad-h">
        <div className="title-row">
          <h2 id="ad-h">Who runs it first</h2>
          <Info id="evidence.adoption" label="" topic="Who runs it first" />
        </div>
        <p className="page-prose jp-intro">Three groups already handle recall claims. Each can run Remedy as it is today.</p>
        <Adoption />
        <Pilot />
      </section>
    </div>
  );
}
