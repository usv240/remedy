import { aboutSeconds, PROBLEM as P, RESEARCH as R } from "@/lib/research";
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
    inRemedy: `A claim photo is matched within 10 bits to its own recall's pictures, and within 4 bits to every other recall's, in a catalog of ${catalogOfficialHashes().length.toLocaleString("en-US")} published pictures, across all recalls, distinct enough to tell their recall apart.`,
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

type Finding = { fig: string; finding: string; source: string; url: string; date?: string; inRemedy: string; code?: string };

/**
 * The problem, measured from primary sources (src/lib/research.ts, PROBLEM, each read 2026-11-08). Paraphrased, never
 * quoted; each with the code in Remedy that answers it, named in the Technical view. Shown on /evidence/market#problem.
 */
function problemFindings(): Finding[] {
  const payout = seconds("payout");
  const p = P.listing;
  return [
    {
      fig: P.correctionRate.rate,
      finding: `The CPSC's own performance measure for ${P.correctionRate.year}: an average correction rate of ${P.correctionRate.rate} across all consumer product recalls, against its ${P.correctionRate.target} target. The method was revised at the FY2024 midyear review, so this figure is an average across recalls; the ${R.comeBack.share} above is a different measure, the share of recalled units that come back, and the two are not comparable.`,
      source: P.correctionRate.source,
      date: P.correctionRate.date,
      url: P.correctionRate.url,
      inRemedy: "Every finished claim is a correction with a timestamp, so the firm's monthly progress report to the CPSC is counted from the ledger, not assembled by hand.",
      code: "src/lib/firm/report.ts, src/lib/audit.ts",
    },
    {
      fig: P.fraudRfi.cite,
      finding: `On ${P.fraudRfi.date} the CPSC opened a request for information on recall claims that are not genuine (docket ${P.fraudRfi.docket}). It names coordinated networks working through online submission forms, artificially generated photos offered as proof of destruction, and the risk that heavier verification lowers participation by the owners the recall is for.`,
      source: P.fraudRfi.source,
      date: P.fraudRfi.date,
      url: P.fraudRfi.url,
      inRemedy: "Both halves of that notice: the checks that catch a copied or reused picture run in code before any model call, and the claim stays one photo on a phone with no account.",
      code: "src/lib/verify/dhash.ts, src/lib/verify/quality.ts, src/lib/verify/decide.ts",
    },
    {
      fig: `${P.adminComment.oneName} and ${P.truepicComment.claims}+`,
      finding: `Two comments on that docket. A recall administrator reported one group registering over ${P.adminComment.products} recalled products at about ${P.adminComment.perUnit} each and one person filing ${P.adminComment.oneName} registrations under one name, said that many unique photos of destroyed units can be made in seconds, and now often requires live photo capture. Truepic reported one device filing over ${P.truepicComment.claims} claims, photos taken from identical vantage points across hundreds of claims, and each claim looking legitimate when reviewed on its own.`,
      source: `${P.adminComment.source}; ${P.truepicComment.source}`,
      date: `${P.adminComment.date}; ${P.truepicComment.date}`,
      url: P.truepicComment.url,
      inRemedy: "The shared hash pool: every claim photo is compared by its 64-bit hash with every photo already claimed at any firm and with every published recall picture, so a reused photo is held before a person sees it, and only the hash crosses between firms.",
      code: "src/lib/verify/dhash.ts (CATALOG_MAX_DISTANCE), content/public/network-run.json",
    },
    {
      fig: "PayPal or a gift card",
      finding: `Firms already pay photo-proof refunds by PayPal. A fan recall page from June 2026 asks for ${P.paypalPortal.photos} photos and no receipt, offers PayPal or a gift card, says PayPal is fastest, promises an email confirmation within ${P.paypalPortal.confirm}, and states no refund delivery time. A 2025 photo-refund page asks owners to allow ${P.weeksPortal.wait}; a claim portal run by a recall administrator pays by check in ${R.portal.days}.`,
      source: `${P.paypalPortal.source}; ${P.weeksPortal.source}; ${R.portal.source}`,
      date: `${P.paypalPortal.date}; ${P.weeksPortal.date}`,
      url: P.paypalPortal.url,
      inRemedy: `Remedy's PayPal payout reached the owner ${payout ? `in about ${payout} seconds` : "in seconds"} after approval, measured in the PayPal sandbox, and a refund to the original PayPal purchase went through at once.`,
      code: "content/public/measured.json, src/lib/payments/router.ts",
    },
    {
      fig: `${p.paypal} of ${p.records.toLocaleString("en-US")}`,
      finding: `Across all ${p.records.toLocaleString("en-US")} records in the CPSC's recall listing since 1973, ${p.paypal === 1 ? "one record names" : `${p.paypal} records name`} PayPal${p.paypalRecall ? ` (recall ${p.paypalRecall})` : ""} and ${p.venmo === 0 ? "none names" : `${p.venmo} name`} Venmo; ${p.electronic} name an electronic payment. The rail firms use on their own pages is nearly absent from the recall notices themselves.`,
      source: P.listing.source,
      date: P.listing.date,
      url: P.listing.url,
      inRemedy: "The count is reproducible: the script reads the CPSC's CSV and writes only the counts, with the file's URL and the date, into the repo.",
      code: "scripts/recalls/listing-mentions.ts, content/recalls/listing-mentions.json",
    },
    {
      fig: `${P.payoutFee.fee} vs ${P.checkCost.cost}`,
      finding: `The issuers' own terms. A PayPal payout through the Payouts API costs the sender a flat ${P.payoutFee.fee} in the US and the recipient nothing; an unclaimed payout returns to the sender after ${P.payoutTerms.unclaimedDays} days; a refund inside ${P.refundTerms.days} days of the purchase reaches the buyer in ${P.refundTerms.reach}. A paper check costs its issuer ${P.checkCost.cost} to send.`,
      source: `${P.payoutFee.source}; ${P.payoutTerms.source}; ${P.refundTerms.source}; ${P.checkCost.source}`,
      date: `${P.payoutFee.date}; ${P.payoutTerms.date}; ${P.refundTerms.date}; AFP ${P.checkCost.date}`,
      url: P.payoutFee.url,
      inRemedy: `The router follows the ${P.refundTerms.days}-day rule, and the ${P.payoutTerms.unclaimedDays}-day expiry is what the PAYMENT.PAYOUTS-ITEM.UNCLAIMED webhook turns into a re-notice task in the firm's plan, so the owner is reached again before the money comes back.`,
      code: "src/lib/payments/router.ts (planPayment), src/lib/payments/events.ts (reNoticeTask)",
    },
    {
      fig: `${P.digitalSuccess.digital} vs ${P.ftcChecks.cashedWeighted}`,
      finding: `In the FTC's study of ${P.ftcChecks.settlements} consumer class settlements, the median claims rate was ${P.ftcChecks.claimsRate}, and a weighted ${P.ftcChecks.cashedWeighted} of the checks sent were cashed (median ${P.ftcChecks.cashedMedian}). A payments processor's 2024 report across nearly 600 cases puts digital payment success at ${P.digitalSuccess.digital}, against ${P.digitalSuccess.checksWithClaims} of checks cashed where there was a claims process and ${P.digitalSuccess.checksWithout} where there was not.`,
      source: `${P.ftcChecks.source}; ${P.digitalSuccess.source}`,
      date: `${P.ftcChecks.date}; ${P.digitalSuccess.date}`,
      url: P.ftcChecks.url,
      inRemedy: "The refund lands in the PayPal account the owner already uses, or goes back to the card or balance that paid, so there is no check to cash.",
      code: "src/lib/payments/router.ts (chooseRoute)",
    },
    {
      fig: `${P.consumerReports.notHeard} and ${P.euSurvey.noReaction}`,
      finding: `Owners' side. In Consumer Reports' survey of ${P.consumerReports.adults} US adults, almost ${P.consumerReports.notHeard} had not heard of a recall for anything they own in five years, and ${P.consumerReports.responded} had heard of one and responded. In the European Commission's survey of ${P.euSurvey.respondents} people, ${P.euSurvey.noReaction} of owners who saw a recall for their product did not react, and ${P.euSurvey.reimbursed} of those who contacted the firm were offered a reimbursement. The CPSC's 2003 review reports that ${P.cpscReview.effort} of non-responders in a vehicle recall survey gave reasons of effort or motivation, such as no time or inconvenience, and about ${P.cpscReview.easier} asked for an easier process.`,
      source: `${P.consumerReports.source}; ${P.euSurvey.source}; ${P.cpscReview.source}`,
      date: `${P.consumerReports.date}; ${P.euSurvey.date}; ${P.cpscReview.date}`,
      url: P.consumerReports.url,
      inRemedy: "The notice and the claim are one link: the firm's buyers are found through Transaction Search, each gets a personal claim link with the refund named in its first line, and the claim is one photo with no account.",
      code: "src/lib/payments/buyers.ts, src/lib/firm/notices.ts",
    },
  ];
}

export const PROBLEM_SOURCES = () => problemFindings().map((f) => ({ source: f.source, url: f.url }));

function Findings({ rows }: { rows: Finding[] }) {
  return (
    <ul className="jg">
      {rows.map((f) => (
        <li key={f.fig} className="jg-item" data-ui>
          <p className="jg-fig tabular">{f.fig}</p>
          <p className="jg-finding">{f.finding}</p>
          <p className="jg-in">
            <span className="jg-k">In Remedy. </span>
            {f.inRemedy}
            {f.code ? <span className="jg-code lp-tech"> {f.code}</span> : null}
          </p>
          <p className="jg-src">
            <a className="text-link" href={f.url} target="_blank" rel="noreferrer">
              {f.source}
            </a>
            {f.date ? <span className="muted">, {f.date}</span> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The published findings Remedy is built on: /evidence#research. */
export function Research() {
  return <Findings rows={FINDINGS} />;
}

/** The problem, measured from primary sources: /evidence/market#problem. */
export function ProblemResearch() {
  return <Findings rows={problemFindings()} />;
}

/**
 * Beside the cross-firm run on /evidence#network: what the recall administrator and Truepic told the CPSC's 2026
 * docket on recall claims, the direct case for a pool that compares hashes across firms.
 */
export function FraudDocket() {
  return (
    <p className="page-prose ev-docket">
      <span className="jg-k">Why a pool across firms. </span>
      On the CPSC&rsquo;s 2026 docket on recall claims that are not genuine, a recall administrator reported one person filing {P.adminComment.oneName} registrations under one name and one group registering over {P.adminComment.products} products at about {P.adminComment.perUnit} each, and Truepic
      reported one device filing over {P.truepicComment.claims} claims with photos from identical vantage points, each claim legitimate when reviewed alone (
      <a className="text-link" href={P.adminComment.url} target="_blank" rel="noreferrer">
        {P.adminComment.short}
      </a>
      ;{" "}
      <a className="text-link" href={P.truepicComment.url} target="_blank" rel="noreferrer">
        {P.truepicComment.short}
      </a>
      ). A photo reused across firms is only visible to a check that sees both firms&rsquo; claims, which is what the hash pool is.
    </p>
  );
}
