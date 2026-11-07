import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { Adoption, Pilot } from "@/components/judges/Adoption";
import { Benchmark } from "@/components/judges/Benchmark";
import { Compare } from "@/components/judges/Compare";
import { ErrorRates } from "@/components/judges/ErrorRates";
import { Load, Real } from "@/components/judges/Load";
import { Measured } from "@/components/judges/Measured";
import { NeverDecides } from "@/components/judges/NeverDecides";
import { Research } from "@/components/judges/Research";
import { PhotoChecks } from "@/components/judges/PhotoChecks";
import { Results } from "@/components/judges/Results";
import { S, extraction } from "@/components/judges/data";
import { TourStart } from "@/components/tour/Tour";
import { TOUR } from "@/components/tour/steps";
import { fmtDate, fmtInt } from "@/lib/api/format";
import "../pages.css";
import "../landing-shared.css";
import "../ops/ops.css";
import "./evidence.css";

export const metadata: Metadata = { title: "Evidence", description: "Every number on this site, where it comes from, and a five-minute path through the product." };

/** The five-minute path: six stops, in the order the story runs. */
const PATH = [
  { href: "/#showcase", label: "Every recall, read as a checklist", time: "20 s", look: "On the home page, type any product into the headline. The closest recalls answer with what each one asks: what to cut or mark, and the refund." },
  { href: "/recalls/27056", label: "One recall's proof rule", time: "40 s", look: "The power bank recall's official remedy (CPSC 27056), word for word, and the checklist Claude read from it, with how sure it is of each field. Switch Display to Technical for the batch trace and the raw CPSC record." },
  { href: "/try", label: "A photo becomes a refund", time: "90 s", look: "Run a preset, or your own photo, through the six checks. In the sample shop, buy Brightline's sample charger, claim it with the cut-cord photo, see it verified, and watch the refund go back to the original PayPal purchase. The receipt follows the payout live." },
  { href: "/firm", label: "The firm's side", time: "60 s", look: "Brightline Home, a fictional sample firm: the claims queue, the recall plan that updates itself from PayPal's payout events, and the monthly report." },
  { href: "/developers", label: "For developers and AI agents", time: "40 s", look: "A free key and a live playground. The same search, proof rules and photo checks are tools on the MCP server." },
  { href: "#results", label: "The numbers, and where they come from", time: "30 s", look: "The CPSC count, the extraction benchmark and the recorded photo checks, each with its source file." },
];

type Part = { name: string; line: string; more?: string; where?: string; links: [string, string][] };

/** Each part of the product, one line on what it does, and where on the site to see it. */
const PARTS: Part[] = [
  {
    name: "Technology",
    line: "Claude Opus 5.5 reads every remedy into a structured proof rule and checks photos against it; plain code makes the decision and PayPal pays.",
    more: "Every part, from the batch to the payout",
    where: `${fmtInt(extraction().counts.recalls)} proof rules extracted with the Message Batches API and a self-check pass; photo checks that start with a free perceptual-hash match against official images and earlier claims, across every recall and every firm; Elastic hybrid search with a reranker; PayPal Payouts, refunds to the original capture inside 180 days, Orders v2 and signature-checked webhooks; a public API with keys and limits, OpenAPI 3.1, and an MCP server.`,
    links: [
      ["/recalls/27056", "A proof rule"],
      ["/try/shop", "Refund to the purchase"],
      ["/developers/docs", "API docs"],
      ["/status", "Status"],
      ["/ops", "Operations"],
      ["/stack", "How it is built"],
    ],
  },
  {
    name: "Design",
    line: "Phone first for owners, every rule and decision with an Info button, Plain and Technical views, and light and dark themes.",
    more: "The standards it is built to",
    where: "WCAG 2.2 AA, checked with axe on every page at phone and desktop widths in both themes; 44 pixel touch targets; type in rem so Large text reaches everything; reduced motion respected. The home page follows one art direction, The sentence is the layout: the CPSC's own made-safe photo sits in the headline where a word would.",
    links: [
      ["/", "Home"],
      ["/try", "Try a photo"],
      ["/recalls", "Recalls"],
    ],
  },
  {
    name: "Impact",
    line: `${fmtInt(S.all.photoRefund.count)} recalls since 2024 already pay on a photo, a growing share, and full remedies raise recall effectiveness.`,
    more: "The numbers and the research",
    where: `${S.byYear["2024"].photoRefund} photo-refund recalls in 2024, ${S.byYear["2025"].photoRefund} in 2025 and ${S.byYear["2026"].photoRefund} in 2026 so far (CPSC Recalls API). Recall effectiveness improves by 11.4% on average when firms offer a full remedy instead of a partial one (Raithel, Hock and Mafael, Journal of the Academy of Marketing Science, 2024). The CPSC's January 2025 order on Amazon called for direct notice and full refunds on proof of destruction.`,
    links: [
      ["#adoption", "Who runs it first"],
      ["/learn#data", "The data method"],
      ["/#research", "The sources"],
    ],
  },
  {
    name: "What is new",
    line: "A recall refund paid the moment the photo checks out, with PayPal's 180-day refund window used as a routing rule.",
    more: "What is new here",
    where: "No recall remedy in the CPSC data mentions PayPal or Venmo. Remedy turns free-text remedies into rules a program can check, keeps the refund pool for real owners with checks that need no AI, and lets AI assistants help an owner through the same tools over MCP.",
    links: [
      ["#compare", "How it compares"],
      ["/developers", "For AI agents"],
    ],
  },
  { name: "Openness", line: "This page and its guided tour, every figure linked to its source file, and what is real and what is a sample, labeled.", links: [["/about", "About"]] },
];

const COST = [
  { what: "Identical requests replay", how: "A request that matches one already answered (same model, prompt, images and settings) is read back from a local cache in test runs instead of paid for again." },
  { what: "An identical photo reuses its result", how: "The same claim photo for the same recall and rule reuses its checked result from the database, with no new AI call." },
  { what: "Images are downscaled", how: "Photos and official images are shrunk before the vision call: up to 16% fewer input tokens on large photos, measured by the verification builder." },
  { what: "The recall's part is cached", how: "Each request puts the recall's data and official images first, so repeat checks on one recall read that part from Claude's prompt cache." },
  { what: "A daily spend cap", how: "The hosted site keeps to a daily AI budget. Past it, every free check still runs and a person at the firm looks at the rest." },
];

const TOC: [string, string][] = [
  ["#path", "Five-minute path"],
  ["#parts", "Each part"],
  ["#benchmark", "Benchmark"],
  ["#photo-checks", "Photo checks"],
  ["#never", "What the AI never decides"],
  ["#measured", "Measured"],
  ["#data", "The data"],
  ["#research", "Grounded in research"],
  ["#cost", "AI cost"],
  ["#load", "Under load"],
  ["#real", "Running it for real"],
  ["#compare", "How it compares"],
  ["#adoption", "Who runs it first"],
];

export default function EvidencePage() {
  const ex = extraction();
  return (
    <div className="page frame evidence">
      <OpenOnHash />
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">Evidence</h1>
          <Info id="page.evidence" />
        </div>
        <p className="lede">Every number on this site, where it comes from, and a five-minute path through the product.</p>
        <p className="jp-tour">
          <TourStart /> <span className="muted">{TOUR.length} stops in this tab, about two minutes. Escape ends it.</span>
        </p>
      </header>

      <div className="jr-head">
        <h2 className="sr-only">Results</h2>
        <Info id="evidence.results" label="" topic="The results" />
      </div>
      <Results />
      <ErrorRates />

      <nav className="jp-toc" aria-label="On this page">
        <ul>
          {TOC.map(([href, label]) => (
            <li key={href}>
              <a className="jp-toc-link" href={href}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="path" className="page-section" aria-labelledby="path-h">
        <h2 id="path-h">The five-minute path</h2>
        <ol className="jp-path">
          {PATH.map((p, i) => (
            <li key={p.label} className="jp-step" data-ui>
              <span className="jp-n tabular" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className="jp-head">
                  <Link className="jp-link" href={p.href}>
                    {p.label}
                  </Link>
                  <span className="jp-time tabular muted">{p.time}</span>
                </p>
                <p>{p.look}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="page-note">Every payout runs in the PayPal sandbox. Brightline Home is a fictional sample firm. Remedy is not affiliated with the CPSC or any recalling firm.</p>
      </section>

      <section id="parts" className="page-section" aria-labelledby="parts-h">
        <h2 id="parts-h">Where to see each part</h2>
        <dl className="jp-parts">
          {PARTS.map((c) => (
            <div key={c.name} className="jp-part">
              <dt>{c.name}</dt>
              <dd>
                <p className="jp-part-line">{c.line}</p>
                <p className="jp-links">
                  {c.links.map(([href, label]) => (
                    <Link key={href + label} className="text-link" href={href}>
                      {label}
                    </Link>
                  ))}
                </p>
                {c.where && (
                  <details className="jx-disc">
                    <summary>{c.more}</summary>
                    <div className="jx-body">
                      <p>{c.where}</p>
                    </div>
                  </details>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="benchmark" className="page-section" aria-labelledby="bench-h">
        <div className="title-row">
          <h2 id="bench-h">Reading the remedy, measured</h2>
          <Info id="evidence.benchmark" label="" topic="The extraction benchmark" />
        </div>
        <p className="page-prose jp-intro">Every check depends on reading the remedy right. Three readers took the same 130 real CPSC remedies, and each field was scored.</p>
        <Benchmark />
      </section>

      <section id="photo-checks" className="page-section" aria-labelledby="photo-h">
        <div className="title-row">
          <h2 id="photo-h">The photo checks, recorded</h2>
          <Info id="evidence.fixtures" label="" topic="The photo checks" />
        </div>
        <p className="page-prose jp-intro">Each case is a real recall photo or a copy made from one. The checks keep the refund pool for real owners: a picture that is not the owner&rsquo;s own is asked to be retaken, kindly.</p>
        <PhotoChecks />
      </section>

      <section id="never" className="page-section" aria-labelledby="never-h">
        <div className="title-row">
          <h2 id="never-h">What the AI never decides</h2>
          <Info id="evidence.never" label="" topic="What the AI never decides" />
        </div>
        <NeverDecides />
      </section>

      <section id="measured" className="page-section" aria-labelledby="measured-h">
        <h2 id="measured-h">Measured in the sandbox</h2>
        <p className="page-prose jp-intro">Timings from the owner&rsquo;s claim flow, run end to end against the PayPal sandbox.</p>
        <Measured />
      </section>

      <section id="data" className="page-section" aria-labelledby="data-h">
        <h2 id="data-h">The data</h2>
        <p className="page-prose">
          Every figure comes from the CPSC Recalls API, pulled {fmtDate(S.pulledAt.slice(0, 10))}: {fmtInt(S.recalls.count)} recalls from {fmtDate(S.range.from)} to {fmtDate(S.range.to)}. A recall counts as a photo refund when its remedy text mentions a photo, picture or image and a refund ({fmtInt(S.all.photoRefund.count)}).
        </p>
        <p className="page-note">Run on the earlier snapshot behind our research note (1,227 recalls to October 29), the same classifier gives the same 523 photo-refund recalls.</p>
        <p className="page-prose">
          <Link className="text-link" href="/learn#data">
            The method, with every definition
          </Link>
        </p>
      </section>

      <section id="research" className="page-section" aria-labelledby="research-h">
        <div className="title-row">
          <h2 id="research-h">Grounded in research</h2>
          <Info id="evidence.research" label="" topic="The research behind Remedy" />
        </div>
        <p className="page-prose jp-intro">Published findings Remedy is built on, each with what Remedy does about it.</p>
        <Research />
      </section>

      <section id="cost" className="page-section" aria-labelledby="cost-h">
        <div className="title-row">
          <h2 id="cost-h">AI cost, kept small</h2>
          <Info id="status.ai_spend" label="" topic="AI spend" />
        </div>
        <p className="page-prose jp-intro tabular">
          Reading all {fmtInt(ex.counts.recalls)} remedies cost ${ex.usage.usd.toFixed(2)} in one batch run. Each photo check is one vision call, and only when the free checks pass.
        </p>
        <details className="jx-disc">
          <summary>The {COST.length} ways each check stays cheap</summary>
          <div className="jx-body">
            <ul className="jc">
              {COST.map((c) => (
                <li key={c.what}>
                  <p className="jc-what">{c.what}</p>
                  <p className="jc-how">{c.how}</p>
                </li>
              ))}
            </ul>
          </div>
        </details>
        <p className="page-note">
          Today&rsquo;s spend, by route, is on{" "}
          <Link className="text-link" href="/status?mode=technical">
            Status
          </Link>{" "}
          in the Technical view.
        </p>
      </section>

      <section id="load" className="page-section" aria-labelledby="load-h">
        <div className="title-row">
          <h2 id="load-h">Under load</h2>
          <Info id="evidence.load" label="" topic="Under load" />
        </div>
        <p className="page-prose jp-intro">One hundred visitors at once on the free paths, against the production build. The claim uses the recall&rsquo;s own official picture, which the perceptual hash settles before any model call.</p>
        <Load />
      </section>

      <section id="real" className="page-section" aria-labelledby="real-h">
        <div className="title-row">
          <h2 id="real-h">Running it for real</h2>
          <Info id="evidence.real" label="" topic="Running it for real" />
        </div>
        <p className="page-prose jp-intro">
          What the demo runs on today, and what a production deployment changes. The operating range, stated plainly; live health is on{" "}
          <Link className="text-link" href="/ops">
            Operations
          </Link>
          .
        </p>
        <Real />
      </section>

      <section id="compare" className="page-section" aria-labelledby="cmp-h">
        <div className="title-row">
          <h2 id="cmp-h">How it compares</h2>
          <Info id="evidence.compare" label="" topic="How it compares" />
        </div>
        <p className="page-prose jp-intro">Each of these does its job. Remedy adds the instant check and the PayPal payout to what firms already do.</p>
        <Compare />
      </section>

      <section id="adoption" className="page-section" aria-labelledby="ad-h">
        <div className="title-row">
          <h2 id="ad-h">Who runs it first</h2>
          <Info id="evidence.adoption" label="" topic="Who runs it first" />
        </div>
        <p className="page-prose jp-intro">Three groups already handle recall claims. Each can run Remedy as it is today.</p>
        <Adoption />
        <Pilot />
      </section>
    </div>
  );
}
