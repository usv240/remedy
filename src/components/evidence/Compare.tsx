import { fmtInt } from "@/lib/api/format";
import { PROBLEM as P } from "@/lib/research";
import { MEASURED, S } from "./data";

/** "17 to 18 seconds", from content/public/measured.json, the same figure the contrast and the README print. */
const payoutFigure = () => (MEASURED.items.find((i) => i.id === "payout")?.figure ?? "seconds").replace(/\bs$/, "seconds");

/**
 * How a photo-refund claim works today, side by side. Each of these does its job; Remedy adds the instant check and
 * the PayPal payout to what firms already do. Cells say only what the CPSC data, the recall texts or the providers'
 * own published pages show (SOURCES below, read 2026-11-07).
 */
const OPTIONS = ["Emailing the photo", "A recall service provider's portal", "Remedy"] as const;

const SOURCES: { n: number; label: string; url: string }[] = [
  { n: 1, label: "Real Time Results, Cuisinart grill recall portal (recallrtr.com), its published page text", url: "https://www.recallrtr.com/SiteResources/3in1grill/locales/en/translation.json" },
  { n: 2, label: "Real Time Results, Bath Shark recall portal (recallrtr.com), its published page text", url: "https://www.recallrtr.com/BathShark/locales/en/translation.json" },
  { n: 3, label: "Sedgwick brand protection, automotive recall services", url: "https://www.sedgwick.com/product-recall/industries/automotive/" },
  { n: 4, label: "Sedgwick brand protection, product recall solutions", url: "https://www.sedgwick.com/product-recall/solutions/" },
  { n: 5, label: `${P.paypalPortal.source} (${P.paypalPortal.date})`, url: P.paypalPortal.url },
  { n: 6, label: `${P.weeksPortal.source} (${P.weeksPortal.date})`, url: P.weeksPortal.url },
];

/**
 * What exists near Remedy, from each one's own page or filing (read 2026-11-08), and the one step it does not do that
 * Remedy does. Neutral words; each does its job. Shown under the comparison on /evidence/market#compare, and the
 * README's "What is first here" points at these rows.
 */
export const LANDSCAPE: { id: string; name: string; date: string; does: string; notThis: string; url: string }[] = [
  {
    id: "truepic-vision",
    name: "Truepic Vision for recall and warranty claims",
    date: "product page, undated; partnership announced February 10, 2025",
    does: "The owner takes a fresh photo inside Truepic's own camera; the photo passes authenticity checks, the model and serial number are read and matched to the firm's records, and duplicate claims and unexpected locations are flagged for the firm's agents to decide.",
    notThis: "It verifies that the capture is real and the serial fits. It does not read the recall's remedy into a rule, judge whether the product was made safe, or pay the refund; those three are what Remedy adds, and an owner's existing photo is accepted.",
    url: "https://www.truepic.com/blog/introducing-truepic-vision-for-consumer-product-safety-warranty-and-recall-claims",
  },
  {
    id: "truepic-risk-network",
    name: "Truepic Risk Network",
    date: "September 25, 2025",
    does: "Opt-in, anonymized signals shared across participating companies: the same device across companies, the same vantage point across hundreds of claims, reused objects. Built for lenders and insurers.",
    notThis: "The signals are about devices and capture. Remedy's pool compares the picture itself, as a 64-bit hash, across recall firms and against every published recall picture, in open code; only the hash and a row id cross.",
    url: "https://www.truepic.com/blog/introducing-the-truepic-risk-network",
  },
  {
    id: "sedgwick",
    name: "Sedgwick brand protection, recall solutions",
    date: "pages read November 8, 2026",
    does: "Consignee identification, contact centers in 150 countries, remedy management with physical and digital reimbursements, retrieval, disposal and reporting. Its automotive page lists checks, virtual checks, PayPal, Venmo and virtual cards among reimbursement options, and a portal where owners upload details and photos.",
    notThis: "PayPal and Venmo are already rails here, so the rail is not what is new. The pages describe photo upload and reimbursement as separate steps worked by people; in Remedy a photo that passes the checks is paid in the same flow, in seconds.",
    url: "https://www.sedgwick.com/product-recall/industries/automotive/",
  },
  {
    id: "rtr",
    name: "Real Time Results claim portals",
    date: "portals from 2023 to 2026",
    does: "A web form: model and serial, a photo of the product marked recalled, contact details and a typed certification. The team verifies the photo, and the refund is a check within 10 to 15 business days or a prepaid virtual card in 10 to 14.",
    notThis: "The photo is read by a person and the money follows in days. Remedy checks the photo in code and vision against the recall's rule and pays through PayPal once it passes.",
    url: "https://www.recallrtr.com/SiteResources/3in1grill/locales/en/translation.json",
  },
  {
    id: "live-capture",
    name: "A recall administrator's live photo capture",
    date: "public comment, June 8, 2026",
    does: "Realtime Results told the CPSC's 2026 docket on recall claims that it now often requires live photo capture with AI analysis, especially where the remedy is a refund, after seeing hundreds of duplicate registrations.",
    notThis: "Live capture checks one claim at the moment it is made. Remedy compares every claim photo with every photo already claimed at any firm and with every published recall picture, so a reused photo is caught across firms, and the owner's existing photo still counts.",
    url: "https://downloads.regulations.gov/CPSC-2026-0067-0013/attachment_1.pdf",
  },
  {
    id: "insurance",
    name: "CCC Estimate-STP and Snapsheet, in auto insurance",
    date: "CCC, November 2021; Snapsheet page read November 8, 2026",
    does: "Photo in, money out, at scale: an AI estimate from the policyholder's photos goes straight to payment or to an adjuster on a confidence threshold, and payouts are triggered by the insurer's payment conditions.",
    notThis: "The pattern exists in insurance and Remedy brings it to recalls. Its gate is different: a fixed set of six checks in code, two reviewers who read different rulebooks, and a person for any disagreement, rather than one confidence score.",
    url: "https://ir.cccis.com/news-releases/news-release-details/ccc-introduces-next-generation-ai-based-photo-analysis",
  },
  {
    id: "patent-2016",
    name: "US 2016/0350756 A1, consumer return of defective products via mobile device photograph submission",
    date: "filed May 29, 2015; published December 1, 2016; abandoned April 6, 2018",
    does: "A phone photographs the defective item, including a destroyed version of it, and the receipt; a refund server shows the photo to refund approval personnel, with optional auto-approval for low-dollar or low-frequency requests.",
    notThis: "The idea of a destruction photo for a refund is a decade old, with a person's review as the primary path. Remedy reads the rule from the official recall text, checks the photo against every firm's claims, and refunds the original PayPal purchase or sends a payout in code.",
    url: "https://patents.google.com/patent/US20160350756A1/en",
  },
];

/** What exists, from its own page, and the one step each does not do. */
export function Landscape() {
  return (
    <ol className="ev-land" aria-label="What exists near Remedy">
      {LANDSCAPE.map((l) => (
        <li key={l.id} id={`land-${l.id}`} className="ev-land-item" data-ui>
          <p className="ev-land-name">
            <a className="text-link" href={l.url} target="_blank" rel="noreferrer">
              {l.name}
            </a>{" "}
            <span className="muted">({l.date})</span>
          </p>
          <p className="ev-land-does">
            <span className="jg-k">What it does. </span>
            {l.does}
          </p>
          <p className="ev-land-not">
            <span className="jg-k">The step it leaves to others. </span>
            {l.notThis}
          </p>
        </li>
      ))}
    </ol>
  );
}

const ROWS: { label: string; cells: [string, string, string] }[] = [
  {
    label: "How common",
    cells: [
      `${fmtInt(S.photoRefund.email.count)} of ${fmtInt(S.all.photoRefund.count)} photo-refund recalls give an email address; ${fmtInt(S.photoRefund.webmail.count)} are free webmail`,
      `${fmtInt(S.all.recallVendor.count)} of ${fmtInt(S.recalls.count)} recalls name a professional recall service provider`,
      "Any firm that pays its refunds through PayPal",
    ],
  },
  {
    label: "The owner sends",
    cells: ["An email with the photo attached", "A web form: the model and serial number, a photo of the product marked as recalled, contact details and a typed certification [1]", "One photo from a phone, no account"],
  },
  { label: "What is read", cells: ["The email, by a person", "The form, by the provider's team [1]", "The CPSC remedy, read once into a rule; then each photo against that rule"] },
  { label: "The photo is checked", cells: ["By a person at the firm", "By the provider's team: “Our team will verify the photo” [1]", "Six checks in seconds, in code and Claude vision; unclear cases go to two AI reviewers, then a person"] },
  {
    label: "The refund is paid",
    cells: [
      "As the firm arranges",
      `By check in 10 to 15 business days after confirmation [1], or a prepaid virtual card in 10 to 14 [2]; one provider lists checks, virtual cards, PayPal and Venmo among its options [3]. On firms' own pages: PayPal or a gift card, with an email confirmation in ${P.paypalPortal.confirm} and no delivery time stated [5], or "allow ${P.weeksPortal.wait}" [6]`,
      `A PayPal payout once verified, which reached the owner in ${payoutFigure()} in the PayPal sandbox, or back to the original PayPal purchase inside 180 days, which PayPal marked COMPLETED at once (it says ${P.refundTerms.reach} to reach the buyer)`,
    ],
  },
  { label: "The monthly report", cells: ["Prepared by the firm", "Real-time tracking and reporting from the provider's own system [4]", "Drafted from Remedy's own numbers"] },
  { label: "For marketplaces and AI agents", cells: ["", "", "A public API and an MCP server"] },
];

export function Compare() {
  return (
    <>
      <div className="cmp-wrap" data-ui role="region" aria-label="How it compares" tabIndex={0}>
        <table className="cmp">
          <caption className="sr-only">How a photo-refund claim works by email, through a recall service provider&rsquo;s portal, and on Remedy</caption>
          <thead>
            <tr>
              <td />
              {OPTIONS.map((o, i) => (
                <th key={o} scope="col" data-rm={i === 2 ? "" : undefined}>
                  {o}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.cells.map((c, i) => (
                  <td key={OPTIONS[i]} data-label={OPTIONS[i]} data-rm={i === 2 ? "" : undefined}>
                    {c || (
                      <>
                        <span className="cmp-none" aria-hidden="true" />
                        <span className="sr-only">Not part of what it does</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="page-note cmp-sources">
        {SOURCES.map((s) => (
          <li key={s.n} value={s.n}>
            [{s.n}]{" "}
            <a className="text-link" href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </li>
        ))}
      </ol>
    </>
  );
}
