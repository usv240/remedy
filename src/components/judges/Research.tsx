import { aboutSeconds, RESEARCH as R } from "@/lib/research";
import { catalogOfficialHashes } from "@/lib/verify/dhash";
import measured from "../../../content/public/measured.json";

const seconds = (id: string) => aboutSeconds(measured.items.find((i) => i.id === id)?.figure);

/**
 * Grounded in research: published findings Remedy is built on, each with what Remedy does about it. Every figure was
 * read from the source itself (2026-11-07) and lives in src/lib/research.ts, which the home page and the README share.
 */
const FINDINGS: { fig: string; finding: string; source: string; url: string; inRemedy: string }[] = [
  {
    fig: R.fullRemedy.lift,
    finding: `A full refund lifts the share of recalled products that come back by ${R.fullRemedy.lift} on average, across ${R.fullRemedy.recalls} CPSC recalls. It works two ways: owners see more benefit, and they feel more able to take part.`,
    source: R.fullRemedy.source,
    url: R.fullRemedy.url,
    inRemedy: "Each claim names the refund in its first line, and the remedy becomes up to four plain steps with a drawing for each.",
  },
  {
    fig: `${R.simpler.from} to ${R.simpler.named}`,
    finding: `In an IRS field experiment with ${R.simpler.filers} tax filers, a simpler notice raised claiming from ${R.simpler.from} to ${R.simpler.to}, and naming the amount in the headline raised it to ${R.simpler.named}.`,
    source: R.simpler.source,
    url: R.simpler.url,
    inRemedy: "One page on a phone, no account, and one photo. The checks explain each result in plain words.",
  },
  {
    fig: R.comeBack.share,
    finding: "Recalled products that come back through a recall, on average, by the CPSC's measure: every finished claim adds to it.",
    source: R.comeBack.source,
    url: R.comeBack.url,
    inRemedy: `A finished claim takes one photo: the check runs in about ${seconds("live-check")} seconds and the PayPal payout in about ${seconds("payout")}, measured in the sandbox.`,
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
