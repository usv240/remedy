import { aboutSeconds, RESEARCH as R } from "@/lib/research";
import { catalogOfficialHashes } from "@/lib/verify/dhash";
import measured from "../../../content/public/measured.json";
import { checkTimes } from "./errors";

const seconds = (id: string) => aboutSeconds(measured.items.find((i) => i.id === id)?.figure);

/**
 * Grounded in research: published findings Remedy is built on, each with what Remedy does about it. Every figure was
 * read from the source itself (2026-11-07) and lives in src/lib/research.ts, which the home page and the README share.
 */
const FINDINGS: { fig: string; finding: string; source: string; url: string; inRemedy: string }[] = [
  {
    fig: `${R.directNotice.direct} vs ${R.directNotice.press}`,
    finding: `Recalls where the firm contacts its buyers directly see about ${R.directNotice.direct} of products corrected by consumers, against ${R.directNotice.press} when the recall reaches them through a press release, by CPSC staff's recall data. The CPSC's own workshop report finds direct notice recalls the most effective.`,
    source: R.directNotice.source,
    url: R.directNotice.url,
    inRemedy: "A firm finds the buyers who paid it with PayPal through Transaction Search, or in its own sales file, and Remedy makes each one a personal claim link and a notice. The firm downloads them for its own mail tool and sends them itself.",
  },
  {
    fig: `${R.euStudy.direct} vs ${R.euStudy.generic}`,
    finding: `In a behavioural experiment for the European Commission, ${R.euStudy.direct} of people shown a direct recall notice decided to act on it, against ${R.euStudy.generic} shown a generic one. Of those who took no action, ${R.euStudy.effort} said the recall process was too much effort or time.`,
    source: R.euStudy.source,
    url: R.euStudy.url,
    inRemedy: "The claim is one page on a phone, no account and one photo, with the refund named in its first line.",
  },
  {
    fig: `About ${R.vehicles.fixed}`,
    finding: `Vehicle recalls, where the maker mails each registered owner, fix about ${R.vehicles.fixed} of vehicles within 18 months, by NHTSA's figures. Consumer products have no owner registry, so the purchase record is the closest thing to one.`,
    source: R.vehicles.source,
    url: R.vehicles.url,
    inRemedy: "PayPal's own record of the purchase stands in for the registry: the buyer is found, and the refund goes back to that same payment inside 180 days.",
  },
  {
    fig: R.fullRemedy.lift,
    finding: `Across ${R.fullRemedy.recalls} CPSC recalls from ${R.fullRemedy.years}, ${R.fullRemedy.what}. Recall effectiveness here is the share of affected products corrected, from the firms' CPSC progress reports. Experiments in the same study find owners see more benefit and feel more able to take part.`,
    source: R.fullRemedy.source,
    url: R.fullRemedy.url,
    inRemedy: "Each claim names the refund in its first line, and the remedy becomes up to four plain steps with a drawing for each.",
  },
  {
    fig: `${R.simpler.from} to ${R.simpler.named}`,
    finding: `From a tax credit, not a recall: in an IRS field experiment with ${R.simpler.filers} tax filers who had not claimed ${R.simpler.benefit} after a first notice, a simpler second notice raised claiming from ${R.simpler.from} to ${R.simpler.to}, and showing the amount they could get more prominently raised it to ${R.simpler.named}.`,
    source: R.simpler.source,
    url: R.simpler.url,
    inRemedy: "One page on a phone, no account, and one photo. The checks explain each result in plain words.",
  },
  {
    fig: R.comeBack.share,
    finding: "Recalled products that come back through a recall, on average, by the CPSC's measure: every finished claim adds to it.",
    source: R.comeBack.source,
    url: R.comeBack.url,
    inRemedy: `A finished claim takes one photo: the check runs in about ${checkTimes().about} seconds (the median of the recorded live checks) and the PayPal payout in about ${seconds("payout")}, measured in the sandbox.`,
  },
  {
    fig: R.amazonOrder.products,
    finding:
      "Products covered by the CPSC's January 2025 order to Amazon: email each buyer directly, and refund the full price to anyone who submits proof the product was destroyed or disposed of.",
    source: R.amazonOrder.source,
    url: R.amazonOrder.url,
    inRemedy: "The same pattern for any firm: buyers who paid with PayPal are found through Transaction Search, and each proof photo is checked and refunded.",
  },
  {
    fig: `${R.dhash.bits} bits`,
    finding: `The difference hash (dHash) treats two pictures more than ${R.dhash.bits} bits apart as different images, and 1 to ${R.dhash.bits} bits as variations of one, after tests on over ${R.dhash.images} images.`,
    source: R.dhash.source,
    url: R.dhash.url,
    inRemedy: `A claim photo is matched within 10 bits to its own recall's pictures, and within 4 bits to the ${catalogOfficialHashes().length.toLocaleString("en-US")} distinct pictures of every other recall.`,
  },
  {
    fig: R.paypal.accounts,
    finding: "Active PayPal accounts at the end of September 2026.",
    source: R.paypal.source,
    url: R.paypal.url,
    inRemedy: "Refunds go back to the original PayPal purchase inside 180 days, or out as a PayPal payout to an email or phone number, with no bank details asked.",
  },
];

export const RESEARCH_SOURCES = FINDINGS.map((f) => ({ source: f.source, url: f.url }));

export function Research() {
  return (
    <ul className="jg">
      {FINDINGS.map((f) => (
        <li key={f.fig} className="jg-item" data-ui>
          <p className="jg-fig tabular">{f.fig}</p>
          <p className="jg-finding">{f.finding}</p>
          <p className="jg-in">
            <span className="jg-k">In Remedy. </span>
            {f.inRemedy}
          </p>
          <p className="jg-src">
            <a className="text-link" href={f.url} target="_blank" rel="noreferrer">
              {f.source}
            </a>
          </p>
        </li>
      ))}
    </ul>
  );
}
