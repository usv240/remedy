import Link from "next/link";
import { Info } from "@/components/Info";
import { fmtInt } from "@/lib/api/format";
import { S, pct } from "./data";

/** The pilot's two outcomes: each with the baseline it is compared to and where Remedy already records it. */
const OUTCOMES = [
  {
    what: "Time from photo to refund",
    baseline: "The firm's median days from an emailed photo to its refund, from its own records for the 30 days before.",
    where: "Each claim's claim.submitted and claim.paid entries in the audit ledger and the payment's paid time, shown in the firm's claims queue.",
  },
  {
    what: "Share of claims a person had to open",
    baseline: "Every emailed photo, which a person reads by hand today.",
    where: "Each claim's decision (verified, new photo, firm review) in the claim table and the ledger's claim.decided entries, and the queue's Needs review view.",
  },
];

/** One concrete pilot with two measured outcomes, and why it holds up if an established tool adds the same AI. */
export function Pilot() {
  return (
    <div className="jpl">
      <div className="jpl-lead">
        <div className="jpl-title-row">
          <h3 className="jpl-title">A 30-day pilot</h3>
          <Info id="evidence.pilot" label="" topic="The pilot" />
        </div>
        <p>
          One small firm with an open photo-refund recall runs every claim on that recall through Remedy for 30 days, from its own claim link, beside its current inbox. Two outcomes are measured against the month before.
        </p>
      </div>
      <ol className="jpl-list">
        {OUTCOMES.map((o) => (
          <li key={o.what}>
            <p className="jpl-what">{o.what}</p>
            <p>
              <span className="jpl-k">Baseline:</span> {o.baseline}
            </p>
            <p>
              <span className="jpl-k">Recorded in:</span> {o.where}
            </p>
          </li>
        ))}
      </ol>
      <p className="jpl-holds">
        <span className="jpl-k">Why it holds up:</span> an established tool that adds the same model gains a reader of photos; what makes each payout safe to send is the checks in code, the hash-chained evidence behind every payment, and the error rates measured on photos with known answers.
      </p>
    </div>
  );
}

/** Who can run Remedy as it is today, with the CPSC numbers behind each group. */
export function Adoption() {
  const groups = [
    {
      who: "Small firms",
      fig: pct(S.all.under50k.share / 100),
      figWhat: "of recalls cover fewer than 50,000 units",
      text: `${fmtInt(S.all.under50k.count)} of ${fmtInt(S.recalls.count)} recalls since 2024, and ${fmtInt(S.photoRefund.under50k.count)} of the ${fmtInt(S.all.photoRefund.count)} photo-refund recalls. A firm works its claims in the console and pays them through PayPal; the monthly report is drafted for it. Next: each firm connecting its own PayPal account.`,
      link: { href: "/firm", label: "The firm console" },
    },
    {
      who: "Marketplaces",
      fig: pct(S.all.soldOnline.share / 100),
      figWhat: "of recalls were sold online",
      text: `${fmtInt(S.all.soldOnline.count)} recalls list an online seller. A marketplace can show each recall's checklist on the order page, verify the buyer's photo with one call, and refund the original PayPal purchase inside 180 days.`,
      link: { href: "/developers", label: "The API" },
    },
    {
      who: "Recall service providers",
      fig: fmtInt(S.all.recallVendor.count),
      figWhat: "recalls name a professional recall vendor",
      text: "A provider handling many firms' recalls can send each emailed photo to the verify endpoint, keep its own process for the rest, and pay the refunds through PayPal.",
      link: { href: "/developers/docs#verify", label: "The verify endpoint" },
    },
  ];
  return (
    <ul className="ja">
      {groups.map((g) => (
        <li key={g.who} className="ja-item">
          <p className="ja-who">{g.who}</p>
          <p className="ja-fig">
            <span className="tabular">{g.fig}</span> <span className="ja-fig-what">{g.figWhat}</span>
          </p>
          <p className="ja-text">{g.text}</p>
          <p>
            <Link className="text-link" href={g.link.href}>
              {g.link.label}
            </Link>
          </p>
        </li>
      ))}
    </ul>
  );
}
