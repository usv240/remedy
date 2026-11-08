import { fmtInt } from "@/lib/api/format";
import { S } from "./data";

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
];

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
      "By check in 10 to 15 business days after confirmation [1], or a prepaid virtual card in 10 to 14 [2]; one provider lists checks, virtual cards, PayPal and Venmo among its options [3]",
      "A PayPal payout once verified, or back to the original PayPal purchase inside 180 days",
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
