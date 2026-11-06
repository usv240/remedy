import Link from "next/link";
import { fmtInt } from "@/lib/api/format";
import { S, pct } from "./data";

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
