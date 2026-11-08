import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { Adoption, Pilot } from "@/components/judges/Adoption";
import { Compare } from "@/components/judges/Compare";
import { Money, VALUE } from "@/components/judges/Money";
import { fmtInt } from "@/lib/api/format";
import { moneyWords } from "@/lib/recall/value";
import "../../pages.css";
import "../../landing-shared.css";
import "../evidence.css";

export const metadata: Metadata = { title: "Stake and adoption", description: "What the photo-refund recalls are worth to their owners, how Remedy compares with claim portals, and who runs it first." };

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
        <p className="lede">What the photo-refund recalls are worth to their owners, how a claim works today, and the three groups that can run Remedy as it is.</p>
      </header>

      <section id="money" className="page-section" aria-labelledby="money-h">
        <div className="title-row">
          <h2 id="money-h">What the recalls are worth to their owners</h2>
          <Info id="evidence.money" label="" topic="What is at stake" />
        </div>
        <Money />
        <p className="page-prose">
          The method: for each of the {fmtInt(VALUE.recalls)} photo-refund recalls, its US units times the sale price its CPSC record states in the Sold At field, taking the lowest price where it states a range. {fmtInt(VALUE.covered)} records state both;
          the {fmtInt(VALUE.recalls - VALUE.covered)} that state no price are left out, not estimated. At the highest stated prices the same units are worth {moneyWords(VALUE.highUsd)}. The 6 in 100 is an average across consumer product recalls, not a measure of
          these recalls in particular.
        </p>
        <div className="jb-wrap" role="region" aria-label="The largest recalls by value" tabIndex={0}>
          <table className="jb">
            <caption className="sr-only">The five largest photo-refund recalls by units times lowest stated price</caption>
            <thead>
              <tr>
                <th scope="col">Recall</th>
                <th scope="col">US units</th>
                <th scope="col">Lowest stated price</th>
                <th scope="col">Units times price</th>
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
                  <td className="jb-num tabular">{fmtInt(r.units)}</td>
                  <td className="jb-num tabular">${r.price.toFixed(2)}</td>
                  <td className="jb-num tabular">${fmtInt(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="page-note">Written by scripts/recalls/value.ts to content/recalls/value.json from the CPSC Recalls API pull; tests/recall-value.test.ts recomputes it.</p>
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
