import type { Metadata } from "next";
import Link from "next/link";
import bench from "../../../content/recalls/benchmark/results.json";
import stats from "../../../content/recalls/stats.json";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { Toc } from "@/components/learn/Toc";
import { fmtDate, fmtInt } from "@/lib/api/format";
import "../pages.css";
import "../landing-shared.css";
import "./toc.css";
import "./disclosure.css";
import "./learn.css";

export const metadata: Metadata = { title: "Learn", description: "How product recalls work, what a proof rule is, the words used on this site, and how every number was counted." };

const C = stats.current;
const V = stats.validation;
const pct = (r: number) => `${(r * 100).toFixed(1).replace(/\.0$/, "")}%`;

const CONTENTS = [
  { id: "recalls", title: "How a recall works" },
  { id: "photo", title: "Why a photo" },
  { id: "rule", title: "What a proof rule is" },
  { id: "checks", title: "How a photo is checked" },
  { id: "glossary", title: "Glossary" },
  { id: "data", title: "Where the numbers come from" },
  { id: "sources", title: "Sources" },
];

const GLOSSARY: [string, string][] = [
  ["Recall", "A firm's plan, agreed with the CPSC, to fix a safety problem with a product it sold: a refund, a repair, a replacement, or new instructions."],
  ["Remedy", "What the owner gets and what they must do for it, in the recall's own words."],
  ["Made safe", "The product changed so it cannot be used again: the cord cut, the item cut in half, or RECALLED written on it, as the remedy asks."],
  ["Proof rule", "The remedy written as a checklist a person and a program can both read: what to do, what the photo must show, and what you get."],
  ["Photo refund", "A recall whose remedy asks for a photo of the product and offers a refund."],
  ["CPSC", "The U.S. Consumer Product Safety Commission, the federal agency that oversees recalls of consumer products."],
  ["Recall number", "The CPSC's number for a recall, for example 27056 (written 27-056 on cpsc.gov)."],
  ["Monthly progress report", "The report a firm sends the CPSC during a recall: how many units were found, fixed, refunded or replaced."],
  ["Payout", "Money sent to someone's PayPal or Venmo account by email address or phone number."],
  ["Refund to the original purchase", "Money sent back to how the owner paid. PayPal allows it within 180 days of the purchase."],
  ["Firm review", "A person at the recalling firm looks at a photo the checks could not settle."],
  ["Sandbox", "PayPal's test system. Every payment on this site runs there, and no real money moves."],
];

/** The words an owner meets first stay in view (a proof rule has its own section above); the rest are one press away. */
const GLOSSARY_SHOWN = 3;

function Term({ t, d }: { t: string; d: string }) {
  return (
    <div id={`term-${t.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <dt>{t}</dt>
      <dd>{d}</dd>
    </div>
  );
}

const DEFS: { label: string; count: number; share: number | null; of: string; definition: string }[] = [
  { label: "Recalls in the period", count: C.recalls.count, share: null, of: "", definition: C.recalls.definition },
  { label: "Ask for a photo", count: C.all.photo.count, share: C.all.photo.share, of: C.all.photo.of, definition: C.all.photo.definition },
  { label: "Offer a refund", count: C.all.refund.count, share: C.all.refund.share, of: C.all.refund.of, definition: C.all.refund.definition },
  { label: "Photo refund", count: C.all.photoRefund.count, share: C.all.photoRefund.share, of: C.all.photoRefund.of, definition: C.all.photoRefund.definition },
  { label: "Ask to write on it", count: C.all.marker.count, share: C.all.marker.share, of: C.all.marker.of, definition: C.all.marker.definition },
  { label: "Ask to cut it", count: C.all.cut.count, share: C.all.cut.share, of: C.all.cut.of, definition: C.all.cut.definition },
  { label: "Photo sent by email", count: C.photoRefund.email.count, share: C.photoRefund.email.share, of: C.photoRefund.email.of, definition: C.photoRefund.email.definition },
  { label: "Email is free webmail", count: C.photoRefund.webmail.count, share: C.photoRefund.webmail.share, of: C.photoRefund.webmail.of, definition: C.photoRefund.webmail.definition },
  { label: "Mention PayPal or Venmo", count: C.all.paypalOrVenmo.count, share: C.all.paypalOrVenmo.share, of: C.all.paypalOrVenmo.of, definition: C.all.paypalOrVenmo.definition },
  { label: "Fewer than 50,000 units", count: C.all.under50k.count, share: C.all.under50k.share, of: C.all.under50k.of, definition: C.all.under50k.definition },
  { label: "Sold online", count: C.all.soldOnline.count, share: C.all.soldOnline.share, of: C.all.soldOnline.of, definition: C.all.soldOnline.definition },
  { label: "Name a recall vendor", count: C.all.recallVendor.count, share: C.all.recallVendor.share, of: C.all.recallVendor.of, definition: C.all.recallVendor.definition },
];

const SOURCES = [
  { name: "CPSC Recalls API", href: "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-01-01", what: "Every recall's record, public domain. The source of every count on this site." },
  {
    name: "CPSC Decision and Order on Amazon, January 16, 2025",
    href: "https://www.cpsc.gov/Newsroom/News-Releases/2025/CPSC-Issues-Final-Order-to-Amazon-com-Outlining-Remediation-Plans-for-Hazardous-Products",
    what: "Direct notice to buyers and full refunds on proof of destruction, for more than 400,000 products. Amazon has challenged it in federal court.",
  },
  {
    name: "Raithel, Hock and Mafael, Product recall effectiveness and consumers' participation in corrective actions, Journal of the Academy of Marketing Science 52, 716 to 735 (2024)",
    href: "https://link.springer.com/article/10.1007/s11747-023-00967-x",
    what: "Recall effectiveness improves by 11.4% on average when firms offer a full remedy instead of a partial one.",
  },
  { name: "CPSC Recall Effectiveness Workshop (2017) and staff report", href: "https://www.cpsc.gov/Recall-Effectiveness", what: "How the CPSC and firms can raise the share of owners who act on a recall." },
  { name: "CPSC Product Safety Planning, Reporting, and Recall Handbook", href: "https://www.cpsc.gov/s3fs-public/RecallHandbookFINAL9_2technicalrevision_3052025.pdf", what: "How a recall is run, including monthly progress reports." },
  { name: "CPSC Monthly Progress Report system", href: "https://www.cpsc.gov/Business--Manufacturing/Recall-Guidance/monthly-progress-report-system", what: "Where firms file those reports." },
];

export default function LearnPage() {
  return (
    <div className="page frame learn">
      <OpenOnHash />
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">How recalls work</h1>
          <Info id="page.learn" />
        </div>
        <p className="lede">What a recall asks you to do, what a proof rule is, the words used on this site, and how every number was counted.</p>
      </header>

      <div className="ln-body">
        <Toc className="ln-toc" items={CONTENTS} />
        <div className="ln-main">
          <section id="recalls" className="page-section ln-sec" aria-labelledby="recalls-h">
            <h2 id="recalls-h">How a recall works</h2>
            <p className="ln-answer">A firm finds a safety problem, agrees a remedy with the CPSC, and tells owners what to do to get it.</p>
            <div className="page-prose">
              <p>
                The CPSC publishes each recall with its hazard, the products and models, pictures, and the remedy: a refund, a repair, a replacement, or new instructions. The firm then reaches owners, by email, by letter, through the stores that sold the product, and through notices.
              </p>
              <p>
                During the recall the firm sends the CPSC a monthly progress report: how many units it found and how many were fixed, refunded or replaced. Most recalls are small: <span className="tabular">{fmtInt(C.all.under50k.count)}</span> of the <span className="tabular">{fmtInt(C.recalls.count)}</span> since January 2024 cover fewer than 50,000 units.
              </p>
            </div>
          </section>

          <section id="photo" className="page-section ln-sec" aria-labelledby="photo-h">
            <h2 id="photo-h">Why a photo</h2>
            <p className="ln-answer">
              When the remedy is a refund, many firms ask for a photo that shows the product made safe, so it cannot be used or sold again. <span className="tabular">{fmtInt(C.all.photoRefund.count)}</span> recalls since 2024 do.
            </p>
            {/* The example photo beside the text it shows, not above it. */}
            <div className="ln-split">
              <div className="page-prose">
                <p>
                  The remedy says what to do first: cut the cord (<span className="tabular">{fmtInt(C.photoRefund.cut.count)}</span> of the photo-refund recalls mention cutting), or write a word such as RECALLED on it in marker (<span className="tabular">{fmtInt(C.photoRefund.marker.count)}</span>). Then the owner sends the photo, most often by email: <span className="tabular">{fmtInt(C.photoRefund.email.count)}</span> of the <span className="tabular">{fmtInt(C.all.photoRefund.count)}</span> give an address.
                </p>
                <p>Remedy takes that photo on a phone, checks it in seconds, and pays the refund through PayPal.</p>
              </div>
              <figure className="ln-fig">
                <img src="/landing/helmet-straps-25007-sm.webp" alt="A recalled bike helmet seen from inside, with both chin straps cut off and laid above it." width={600} height={730} loading="lazy" />
                <figcaption>Recall 25007: the CPSC&rsquo;s example of a photo the firm accepts, straps cut off. Photo: CPSC.</figcaption>
              </figure>
            </div>
          </section>

          <section id="rule" className="page-section ln-sec" aria-labelledby="rule-h">
            <div className="title-row">
              <h2 id="rule-h">What a proof rule is</h2>
              <Info id="learn.rule" label="" topic="What a proof rule is" />
            </div>
            <p className="ln-answer">The remedy, rewritten as a checklist: what to do to the product, what the photo must show, and what you get.</p>
            <div className="ln-example" data-ui>
              <p className="ln-ex-k">Recall 27056, word for word</p>
              <blockquote>&ldquo;To receive a refund, consumers will be required to submit a photo of their recalled power bank with the word &lsquo;recalled&rsquo; written on it in permanent marker&hellip;&rdquo;</blockquote>
              <p className="ln-ex-k">As a proof rule</p>
              <dl className="ln-ex-rule">
                <div>
                  <dt>First</dt>
                  <dd>
                    <span className="chip">Write RECALLED</span>
                  </dd>
                </div>
                <div>
                  <dt>The photo shows</dt>
                  <dd>
                    <span className="chip">The whole product</span> <span className="chip">RECALLED written on it</span>
                  </dd>
                </div>
                <div>
                  <dt>You get</dt>
                  <dd>
                    <span className="chip">Full refund</span>
                  </dd>
                </div>
              </dl>
              <p className="ln-ex-link">
                <Link className="text-link" href="/recalls/27056">
                  The whole rule, with how sure each field is
                </Link>
              </p>
            </div>
            <details className="dsc ln-more">
              <summary>
                <span className="dsc-k">How the rules were made</span>
              </summary>
              <div className="page-prose">
                <p>
                  Claude Opus 5.5 read each remedy with a fixed schema and a written guide, then a second pass checked the draft against the remedy text and a set of mechanical rules (for example: a rule that says &ldquo;cut the cord&rdquo; must come from a remedy that mentions a cord). Every photo-refund recall has one, run through the Message Batches API.
                </p>
                <p>
                  On {bench.sample.items} real remedies, every field was right in {pct(bench.variants.claude_selfcheck.allFieldsCorrect.rate)} with the self-check and {pct(bench.variants.baseline.allFieldsCorrect.rate)} with keyword rules alone, scored against draft labels that are being checked by hand.{" "}
                  <Link className="text-link" href="/judges#benchmark">
                    The benchmark
                  </Link>
                </p>
              </div>
            </details>
          </section>

          <section id="checks" className="page-section ln-sec" aria-labelledby="checks-h">
            <h2 id="checks-h">How a photo is checked</h2>
            <p className="ln-answer">Six checks: right product, made safe, your own photo, within the recall, claim limits, and not already refunded.</p>
            <div className="page-prose">
              <p>When every check passes, PayPal pays. When the photo needs another try, you see exactly what to change. When the checks cannot settle it, two AI reviewers look, and then a person at the firm.</p>
            </div>
            <details className="dsc ln-more">
              <summary>
                <span className="dsc-k">What each check looks for</span>
              </summary>
            <ol className="ln-checks">
              <li>
                <strong>Right product.</strong> The photo is compared with the recall&rsquo;s official pictures, its name and its model numbers.
              </li>
              <li>
                <strong>Made safe.</strong> Each step the rule asks for is looked for: the cut, or the exact word written on it.
              </li>
              <li>
                <strong>Your own photo.</strong> It is not the recall&rsquo;s own picture, a photo of a screen, or a photo sent before. This keeps the refund pool for real owners.
              </li>
              <li>
                <strong>Within the recall.</strong> When the recall names models or lot numbers, the one in the photo is among them.
              </li>
              <li>
                <strong>Claim limits.</strong> One refund for each unit bought.
              </li>
              <li>
                <strong>Not already refunded.</strong> A linked PayPal purchase has no earlier refund.
              </li>
            </ol>
            </details>
          </section>

          <section id="glossary" className="page-section ln-sec" aria-labelledby="glossary-h">
            <h2 id="glossary-h">Glossary</h2>
            <dl className="ln-gloss">
              {GLOSSARY.slice(0, GLOSSARY_SHOWN).map(([t, d]) => (
                <Term key={t} t={t} d={d} />
              ))}
            </dl>
            <details className="dsc ln-more">
              <summary>
                <span className="dsc-k">
                  {GLOSSARY.length - GLOSSARY_SHOWN} more words, from {GLOSSARY[GLOSSARY_SHOWN][0]} to {GLOSSARY[GLOSSARY.length - 1][0]}
                </span>
              </summary>
              <dl className="ln-gloss">
                {GLOSSARY.slice(GLOSSARY_SHOWN).map(([t, d]) => (
                  <Term key={t} t={t} d={d} />
                ))}
              </dl>
            </details>
          </section>

          <section id="data" className="page-section ln-sec" aria-labelledby="data-h">
            <h2 id="data-h">Where the numbers come from</h2>
            <p className="ln-answer">
              Every figure is counted from the CPSC Recalls API: <span className="tabular">{fmtInt(C.recalls.count)}</span> recalls from {fmtDate(C.range.from)} to {fmtDate(C.range.to)}, pulled {fmtDate(C.pulledAt.slice(0, 10))}. <span className="tabular">{fmtInt(C.all.photoRefund.count)}</span> of them ask for a photo and offer a refund.
            </p>
            <div className="page-prose">
              <p>
                A small deterministic classifier reads each recall&rsquo;s remedy text (every <code>Remedies[].Name</code> joined), its consumer contact, retailers and units. No AI is used to count.
              </p>
            </div>
            <p className="ln-years tabular">
              Photo-refund recalls by year: {Object.entries(C.byYear)
                .map(([y, v]) => `${y}: ${v.photoRefund} of ${v.recalls}`)
                .join("; ")}
              {" "}(2026 to {fmtDate(C.range.to)}).
            </p>
            <details id="figures" className="dsc ln-more">
              <summary>
                <span className="dsc-k">The rule for each of the {DEFS.length} figures, word for word from the stats file</span>
              </summary>
            <div className="ln-table-wrap" data-ui role="region" aria-label="Every figure and how it was counted" tabIndex={0}>
              <table className="ln-table">
                <thead>
                  <tr>
                    <th scope="col">Figure</th>
                    <th scope="col" className="ln-num">
                      Count
                    </th>
                    <th scope="col" className="ln-num">
                      Share
                    </th>
                    <th scope="col">How it was counted</th>
                  </tr>
                </thead>
                <tbody>
                  {DEFS.map((d) => (
                    <tr key={d.label}>
                      <th scope="row">{d.label}</th>
                      <td className="ln-num tabular">{fmtInt(d.count)}</td>
                      <td className="ln-num tabular">{d.share === null ? "-" : `${d.share}%`}</td>
                      <td className="ln-def">
                        {d.of && <span className="muted">Of {d.of}. </span>}
                        <span className="ln-def-text">{d.definition}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </details>
            <details className="dsc ln-more">
              <summary>
                <span className="dsc-k">The earlier snapshot, and what changed</span>
              </summary>
              <div className="page-prose">
                <p>
                  Our research note used a pull of {fmtDate(V.pulledAt)}: <span className="tabular">{fmtInt(V.recalls.count)}</span> recalls to {fmtDate(V.range.to)}, <span className="tabular">{fmtInt(V.all.photoRefund.count)}</span> of them photo refunds. The same classifier on that snapshot gives the same photo-refund count. {stats.difference.explanation}
                </p>
                <p>{stats.difference.units}</p>
              </div>
            </details>
            <p className="page-note">
              Files: content/recalls/stats.json (written by scripts/recalls/stats.ts) and the classifier in src/lib/recall/classify.ts. Every recall is also available as JSON from{" "}
              <Link className="text-link" href="/developers/docs#recalls">
                the recalls API
              </Link>
              .
            </p>
          </section>

          <section id="sources" className="page-section ln-sec" aria-labelledby="sources-h">
            <h2 id="sources-h">Sources</h2>
            <p className="ln-answer">
              {SOURCES.length} public sources, from the CPSC&rsquo;s own records to one peer-reviewed study.
            </p>
            <details className="dsc ln-more">
              <summary>
                <span className="dsc-k">All {SOURCES.length} sources, with what each one says</span>
              </summary>
            <ul className="ln-sources">
              {SOURCES.map((s) => (
                <li key={s.href}>
                  <a className="text-link" href={s.href} target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                  <span className="muted"> {s.what}</span>
                </li>
              ))}
            </ul>
            </details>
            <p className="page-note">Recall data and images: U.S. Consumer Product Safety Commission, public domain. Remedy is independent and not affiliated with the CPSC.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
