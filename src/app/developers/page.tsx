import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/Info";
import { CopyButton } from "@/components/developers/CopyButton";
import { DevConsole } from "@/components/developers/DevConsole";
import { EmbedBadge } from "@/components/developers/EmbedBadge";
import { LIMITS } from "@/lib/api/keys";
import { HOSTED_URL } from "@/lib/origin";
import "../pages.css";
import "./dev.css";

export const metadata: Metadata = { title: "Developers", description: "Add verify-and-refund to any recall page: free sandbox keys, a live playground, docs and an MCP server." };

const HOST = (process.env.RENDER_EXTERNAL_URL || HOSTED_URL).replace(/\/$/, "");

/** The first call shown beside the lede: one that works on every deployment, with or without keys or Elastic. */
const FIRST_CURL = `curl "${HOST}/api/v1/recalls?query=power%20bank&photo_refund=true&limit=3"`;

const USES: { who: string; what: string; link?: { href: string; label: string } }[] = [
  { who: "Marketplaces and retailers", what: "Show a recall's proof rule on the product page, and verify a buyer's photo before the refund is sent.", link: { href: "/developers/docs#verify", label: "Verify a photo" } },
  { who: "Recall service providers", what: "Turn emailed photos into verified claims, with each check and its reason, and pay the refund through PayPal.", link: { href: "/developers/docs#proof-rule", label: "Read a proof rule" } },
  { who: "AI agents", what: "Connect the Remedy MCP server: search_recalls, scan_catalog, get_proof_rule, verify_photo, open_claim and claim_status.", link: { href: "/developers/docs#mcp", label: "The MCP server" } },
  { who: "Catalogs", what: "Send every product you list in one call and get back which ones a recall covers, which pay a refund for a photo, and the claim link for each.", link: { href: "/developers/docs#scan", label: "Scan a catalog" } },
];

export default function DevelopersPage() {
  return (
    <div className="page frame developers">
      <div className="dev-hero">
        <header className="page-head">
          <div className="title-row">
            <h1 className="page-title">Developers</h1>
            <Info id="page.developers" />
          </div>
          <p className="lede">Add verify-and-refund to any recall page. One API call, or our MCP server.</p>
        </header>
        <figure className="dev-first" data-ui>
          <div className="dev-first-head">
            <figcaption>First call: recalls that pay on a photo</figcaption>
            <CopyButton text={FIRST_CURL} label="Copy" />
          </div>
          <pre className="dev-pre tabular" tabIndex={0} aria-label="First call, in cURL">
            {FIRST_CURL}
          </pre>
          <p className="dev-first-note">
            Each hit carries its proof rule: what to cut or mark, what the photo must show, and the refund. No key needed for reads; <code>/api/health</code> shows what is connected.
          </p>
        </figure>
      </div>

      <ul className="dev-uses">
        {USES.map((u) => (
          <li key={u.who} className="dev-use">
            <p className="dev-use-who">{u.who}</p>
            <p>{u.what}</p>
            {u.link && (
              <p className="dev-use-link">
                <Link className="text-link" href={u.link.href}>
                  {u.link.label}
                </Link>
              </p>
            )}
          </li>
        ))}
        <li className="dev-use dev-limits">
          <p className="dev-use-who">Limits</p>
          <p className="tabular">
            With a key: {LIMITS.keyPerMinute} requests a minute, {LIMITS.keyPerDay.toLocaleString("en-US")} a day. Without: {LIMITS.demoPerMinute} a minute.
          </p>
        </li>
      </ul>

      <EmbedBadge host={HOST} />

      <DevConsole />

      <p className="dev-source">
        <a className="text-link" href="https://github.com/usv240/remedy">
          Source
        </a>
      </p>
    </div>
  );
}
