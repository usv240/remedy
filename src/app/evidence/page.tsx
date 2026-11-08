import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { Benchmark } from "@/components/judges/Benchmark";
import { ErrorRates } from "@/components/judges/ErrorRates";
import { Measured } from "@/components/judges/Measured";
import { NeverDecides } from "@/components/judges/NeverDecides";
import { Research } from "@/components/judges/Research";
import { Contrast } from "@/components/judges/Contrast";
import { Money } from "@/components/judges/Money";
import { Network } from "@/components/judges/Network";
import { freeCaught, freeTimings, hashSpeed, readingAccuracy } from "@/components/judges/errors";
import { Results } from "@/components/judges/Results";
import { Tested } from "@/components/judges/Tested";
import { S } from "@/components/judges/data";
import { DEFAULT_TERMS } from "@/app/api/claims/_lib/terms";
import { limitRules } from "@/lib/firm/limits";
import { TourStart } from "@/components/tour/Tour";
import { TOUR } from "@/components/tour/steps";
import { fmtDate, fmtInt } from "@/lib/api/format";
import { HEADLINE } from "@/lib/recall/headline";
import "../pages.css";
import "../landing-shared.css";
import "../ops/ops.css";
import "./evidence.css";

export const metadata: Metadata = { title: "Evidence", description: "Every number on this site, where it comes from, and a five-minute path through the product." };

/** The five-minute path: six stops, in the order the story runs. */
const PATH = [
  { href: "/#showcase", label: "Every recall, read as a checklist", time: "20 s", look: "On the home page, type any product into the headline. The closest recalls answer with what each one asks: what to cut or mark, and the refund." },
  { href: "/recalls/27056", label: "One recall's proof rule", time: "40 s", look: "The power bank recall's official remedy (CPSC 27056), word for word, and the checklist Claude read from it, with how sure it is of each field. Switch Display to Technical for the batch trace and the raw CPSC record." },
  { href: "/try", label: "A photo becomes a refund", time: "90 s", look: "Run Brightline's sample charger with its cord cut through the six checks, or your own photo. In the sample shop, buy the charger, claim it with the sample photo, see it verified, and watch the refund go back to the original PayPal purchase. The receipt follows the refund live." },
  { href: "/firm", label: "The firm's side", time: "60 s", look: "Brightline Home, a fictional sample firm: the claims queue, the recall plan that updates itself from PayPal's payout events, and the monthly report." },
  { href: "/developers", label: "For developers and AI agents", time: "40 s", look: "A free key and a live playground, and a recorded session of an AI assistant using the MCP tools to find a recall and open a claim." },
  { href: "#results", label: "The numbers, and where they come from", time: "30 s", look: "The CPSC count, the extraction benchmark and the recorded photo checks, each with its source file." },
];

type Part = { name: string; line: string; links: [string, string][] };

/** Each part of the product, one line on what it does, and where on the site to see it. */
const PARTS: Part[] = [
  {
    name: "Technology",
    line: "Claude Opus 5.5 reads every remedy into a structured proof rule and checks photos against it; plain code makes the decision and PayPal pays.",
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
    links: [
      ["/", "Home"],
      ["/try", "Try a photo"],
      ["/recalls", "Recalls"],
    ],
  },
  {
    name: "Impact",
    line: `${fmtInt(HEADLINE.count)} recalls since 2024 already refund a photo of the product made safe, and more each year. Their portals pay by check in days; Remedy's PayPal payout lands in seconds.`,
    links: [
      ["/evidence/market#adoption", "Who runs it first"],
      ["/learn#data", "The data method"],
      ["/#research", "The sources"],
    ],
  },
  {
    name: "What is new",
    line: "Each firm that joins makes the others safer, the refund goes back the way it was paid, and a payout nobody accepts becomes a task in the recall plan.",
    links: [
      ["#network", "One photo, two firms"],
      ["/evidence/market#compare", "How it compares"],
      ["/developers", "For AI agents"],
    ],
  },
  { name: "Openness", line: "This page and its guided tour, every figure linked to its source file, and what is real and what is a sample, labeled.", links: [["/about", "About"]] },
];


const TOC: [string, string][] = [
  ["#path", "Five-minute path"],
  ["#parts", "Each part"],
  ["#network", "Across firms"],
  ["#benchmark", "Benchmark"],
  ["#photo-checks", "Photo checks"],
  ["#never", "What the AI never decides"],
  ["#measured", "Measured"],
  ["#tested", "Tested"],
  ["#data", "The data"],
  ["#research", "Grounded in research"],
  ["#more", "More evidence"],
];

/** The longer tables and lists, each on its own page. */
const MORE: { href: string; title: string; line: string }[] = [
  { href: "/evidence/photo-checks", title: "Every photo check, recorded", line: "Each recorded run with its six checks, the model settings compared, and what the model read on the CPSC's own photos." },
  { href: "/evidence/operations", title: "Cost, load and running it for real", line: "How each check stays cheap, one hundred visitors at once, and what a production deployment changes." },
  { href: "/evidence/market", title: "What is at stake, and who runs it first", line: "The money method and its largest recalls, how Remedy compares with claim portals, and the 30-day pilot." },
];

export default function EvidencePage() {
  const fc = freeCaught();
  const t = freeTimings();
  const ra = readingAccuracy();
  const free = { caught: fc.caught, total: fc.total, retake: t.retake, firmReview: t.firmReview };
  return (
    <div className="page frame evidence">
      <OpenOnHash />
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">Evidence</h1>
          <Info id="page.evidence" />
        </div>
        <p className="lede">
          {fmtInt(HEADLINE.count)} of {fmtInt(S.recalls.count)} US product recalls since 2024 already refund an owner who sends one photo of the product made safe. Here is what Remedy does with that photo, measured, with the file behind every number.
        </p>
        <p className="jp-tour">
          <TourStart /> <span className="muted">{TOUR.length} stops in this tab, about two minutes. Escape ends it.</span>
        </p>
      </header>

      <div className="jr-head">
        <h2 className="sr-only">Results</h2>
        <Info id="evidence.results" label="" topic="The results" />
      </div>
      <Results />
      <section id="money" className="page-section ev-stake" aria-labelledby="money-h">
        <div className="title-row">
          <h2 id="money-h">What changes, and what is at stake</h2>
          <Info id="evidence.money" label="" topic="What is at stake" />
        </div>
        <Contrast className="vs ev-vs" />
        <Money />
        <p className="page-note">
          Counted from the CPSC records and each recall&rsquo;s proof rule; pro-rated refunds and recalls that state no price are left out, not estimated.{" "}
          <Link className="text-link" href="/evidence/market#money">
            The method and the largest recalls
          </Link>
        </p>
      </section>
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
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="network" className="page-section" aria-labelledby="network-h">
        <h2 id="network-h">One photo, two firms</h2>
        <Network />
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
        <p className="page-prose jp-intro tabular">
          Before any AI call, {free.caught} of {free.total} recorded photos that needed a closer look were stopped by code: {free.retake} asked for a new photo (the recall&rsquo;s own pictures, turned and cropped copies, another recall&rsquo;s picture, a blurry
          photo) and {free.firmReview === 1 ? "one photo already used on an earlier claim went" : `${free.firmReview} photos already used went`} to a person at the firm. {hashSpeed().sentence} Reading the CPSC&rsquo;s own photos with that match off, the model was right on {ra.right} of {ra.readings} readings.
        </p>
        <p className="page-prose">
          <Link className="text-link" href="/evidence/photo-checks">
            Every recorded run, the model settings compared, and what the model read
          </Link>
        </p>
      </section>

      <section id="never" className="page-section" aria-labelledby="never-h">
        <div className="title-row">
          <h2 id="never-h">What the AI never decides</h2>
          <Info id="evidence.never" label="" topic="What the AI never decides" />
        </div>
        <NeverDecides />
        <h3 className="ev-sub">Claim limits, in plain rules</h3>
        <ul className="ev-rules">
          {limitRules(DEFAULT_TERMS).map((r) => (
            <li key={r.title}>
              <strong>{r.title}.</strong> {r.rule}
            </li>
          ))}
        </ul>
        <p className="page-note">The sample firm&rsquo;s settings; each firm sets its own. Counted in code by src/lib/firm/limits.ts and checked again when a claim is paid.</p>
      </section>

      <section id="measured" className="page-section" aria-labelledby="measured-h">
        <h2 id="measured-h">Measured in the sandbox</h2>
        <p className="page-prose jp-intro">Timings from the owner&rsquo;s claim flow, run end to end against the PayPal sandbox.</p>
        <Measured />
      </section>

      <section id="tested" className="page-section" aria-labelledby="tested-h">
        <h2 id="tested-h">How it is tested</h2>
        <p className="page-prose jp-intro">The suites behind every page, counted when they last ran.</p>
        <Tested />
      </section>

      <section id="data" className="page-section" aria-labelledby="data-h">
        <h2 id="data-h">The data</h2>
        <p className="page-prose">
          Every figure comes from the CPSC Recalls API, pulled {fmtDate(S.pulledAt.slice(0, 10))}: {fmtInt(S.recalls.count)} recalls from {fmtDate(S.range.from)} to {fmtDate(S.range.to)}. A recall counts as a photo refund when its remedy text mentions a photo, picture or image and a refund ({fmtInt(S.all.photoRefund.count)}). The headline then reads each one&rsquo;s proof rule: {fmtInt(HEADLINE.count)} ask for a photo of the product made safe and pay a refund in money for it.
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

      <section id="more" className="page-section" aria-labelledby="more-h">
        <h2 id="more-h">More evidence</h2>
        <ul className="ev-more">
          {MORE.map((m) => (
            <li key={m.href}>
              <Link className="text-link ev-more-k" href={m.href}>
                {m.title}
              </Link>
              <span className="muted">{m.line}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
