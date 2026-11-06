import { fmtInt } from "@/lib/api/format";
import { S } from "./data";

/**
 * How a photo-refund claim works today, side by side. Each of these does its job; Remedy adds the instant check and
 * the PayPal payout to what firms already do. Cells say only what the data or the recall texts show.
 */
const OPTIONS = ["Emailing the photo", "A recall vendor's portal", "Remedy"] as const;

const ROWS: { label: string; cells: [string, string, string] }[] = [
  {
    label: "How common",
    cells: [
      `${fmtInt(S.photoRefund.email.count)} of ${fmtInt(S.all.photoRefund.count)} photo-refund recalls give an email address; ${fmtInt(S.photoRefund.webmail.count)} are free webmail`,
      `${fmtInt(S.all.recallVendor.count)} of ${fmtInt(S.recalls.count)} recalls name a professional recall vendor`,
      "Any firm, from its own PayPal account",
    ],
  },
  { label: "The owner sends", cells: ["An email with the photo attached", "A form on the vendor's site", "One photo from a phone, no account"] },
  { label: "The photo is checked", cells: ["By a person at the firm", "By the vendor's process", "Six checks in seconds; unclear cases go to two AI reviewers, then a person"] },
  { label: "The refund is paid", cells: ["As the firm arranges", "As the vendor arranges", "PayPal Payouts, or back to the original PayPal purchase inside 180 days"] },
  { label: "The monthly report", cells: ["Prepared by the firm", "As the vendor arranges", "Drafted from Remedy's own numbers"] },
  { label: "For marketplaces and AI agents", cells: ["", "", "A public API and an MCP server"] },
];

export function Compare() {
  return (
    <div className="cmp-wrap" data-ui role="region" aria-label="How it compares" tabIndex={0}>
      <table className="cmp">
        <caption className="sr-only">How a photo-refund claim works by email, through a recall vendor, and on Remedy</caption>
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
  );
}
