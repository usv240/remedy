import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { Benchmark } from "@/components/evidence/Benchmark";
import { ErrorRates } from "@/components/evidence/ErrorRates";
import { Measured } from "@/components/evidence/Measured";
import { NeverDecides } from "@/components/evidence/NeverDecides";
import { FraudDocket, Research } from "@/components/evidence/Research";
import { PROBLEM } from "@/lib/research";
import { LANDSCAPE } from "@/components/evidence/Compare";
import { Contrast } from "@/components/evidence/Contrast";
import { Money, moneyHeadline } from "@/components/evidence/Money";
import { Network } from "@/components/evidence/Network";
import { HashPoolCall, HashPoolCallLive } from "@/components/evidence/HashPoolCall";
import { HashReuse } from "@/components/evidence/HashReuse";
import { checkTimeWords, errorRates, freeCaught, freeTimings, hashSpeed, readingAccuracy } from "@/components/evidence/errors";
import { Fold } from "@/components/evidence/Fold";
import { PoolLimits, poolLimits } from "@/components/evidence/PoolLimits";
import { PoolTrust } from "@/components/evidence/PoolTrust";
import { Results } from "@/components/evidence/Results";
import { Tested } from "@/components/evidence/Tested";
import { BENCH, MEASURED, S } from "@/components/evidence/data";
import { DEFAULT_TERMS } from "@/app/api/claims/_lib/terms";
import { limitRules } from "@/lib/firm/limits";
import { TourStart } from "@/components/tour/Tour";
import { TOUR } from "@/components/tour/steps";
import { fmtDate, fmtInt } from "@/lib/api/format";
import { HEADLINE } from "@/lib/recall/headline";
import { RECORDED_RECEIPT_URL } from "@/lib/recorded-receipt";
import "../pages.css";
import "../landing-shared.css";
import "../ops/ops.css";
import "./evidence.css";

export const metadata: Metadata = { title: "Evidence", description: "Every number on this site, where it comes from, and a path through the product that starts with one photo." };

/*
 * The page opens on two screens: the five-minute path and the results band. Every other section is closed under its
 * heading with one line of what it holds (Fold), and opens on a press or from any link into it (OpenOnHash).
 */

/**
 * The longer path: six stops. It starts where the home page and the README start, with Try a photo, so there is one
 * first step everywhere.
 */
const PATH = [
  { href: "/try", label: "A photo becomes a refund", time: "90 s", look: "Try a photo, as on the home page: run Brightline's sample charger with its cord cut through the six checks and send its $34.99 refund as a real PayPal sandbox payout, or open a recorded receipt without sending one. In the sample shop, buy the charger, claim it with the sample photo, and watch the refund go back to the original PayPal purchase." },
  { href: "/#showcase", label: "Every recall, read as a checklist", time: "20 s", look: "On the home page, type any product into the headline. The closest recalls answer with what each one asks: what to cut or mark, and the refund." },
  { href: "/recalls/27056", label: "One recall's proof rule", time: "40 s", look: "The power bank recall's official remedy (CPSC 27056), word for word, and the checklist Claude read from it, with how sure it is of each field. Switch Plain or Technical, top right, to Technical for the batch trace and the raw CPSC record." },
  { href: "/firm", label: "The firm's side", time: "60 s", look: "Brightline Home, a fictional sample firm: the claims queue, the recall plan that updates itself from PayPal's payout events, and the monthly report." },
  { href: "/developers", label: "For developers and AI agents", time: "40 s", look: "A free key and a live playground, and a recorded session of an AI assistant using the MCP tools to find a recall and open a claim." },
  { href: "#results", label: "The numbers, and where they come from", time: "30 s", look: "The CPSC count, the extraction benchmark and the recorded photo checks, each with its source file." },
];

type Part = { name: string; line: string; links: [string, string][] };

/** Each part of the product, one line on what it does, and where on the site to see it. */
const PARTS: Part[] = [
  {
    name: "Checks and payment",
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
    name: "The owner's screens",
    line: "Phone first for owners, every rule and decision with an Info button, Plain and Technical views, and light and dark themes.",
    links: [
      ["/", "Home"],
      ["/try", "Try a photo"],
      ["/recalls", "Recalls"],
    ],
  },
  {
    name: "Who it helps",
    line: `${fmtInt(HEADLINE.count)} recalls since 2024 already refund a photo of the product made safe, and more each year. Their portals pay by check in days; Remedy's PayPal payout lands in seconds.`,
    links: [
      ["/evidence/market#adoption", "Who runs it first"],
      ["/learn#data", "The data method"],
      ["/#research", "The sources"],
    ],
  },
  {
    name: "Three ideas",
    line: "Each firm that joins makes the others safer, the refund goes back the way it was paid, and a payout nobody accepts becomes a task in the recall plan.",
    links: [
      ["#network", "One photo, two firms"],
      ["/evidence/market#compare", "How it compares"],
      ["/developers", "For AI agents"],
    ],
  },
  { name: "Sources and labels", line: "This page and its guided tour, every figure linked to its source file, and what is real and what is a sample, labeled.", links: [["/about", "About"]] },
];


/**
 * What is first here, each line tied to the rows on /evidence/market#compare that show the nearest existing thing. No
 * claim beyond what those rows support.
 */
const FIRST: { line: string; near: string; rows: string[] }[] = [
  {
    line: "A photo of the product made safe, checked against a rule read from the official CPSC remedy text, then paid through PayPal in the same flow.",
    near: "The nearest product verifies that the capture is real and the serial fits, and leaves the decision to the firm's agents without paying; the one patent application on this flow had a person's review as its primary path and was abandoned in 2018.",
    rows: ["truepic-vision", "patent-2016", "rtr"],
  },
  {
    line: "A pool of photo hashes shared across firms, so a photo already paid at one firm is held at the next before any model call, with only two 64-bit hashes and a row id crossing.",
    near: "The nearest shared-signal network is built on device and capture signals for lenders and insurers; the nearest recall tool checks one claim live at the moment it is made.",
    rows: ["truepic-risk-network", "live-capture"],
  },
  {
    line: "The refund goes back to the original PayPal purchase inside PayPal's 180-day window, else out as a payout, and a payout nobody accepts becomes a re-notice task in the firm's plan.",
    near: "PayPal and Venmo are already reimbursement rails at the largest administrator, so the rail is not new; the step from a verified photo to that money in one flow, and the unclaimed payout turned into a task, are.",
    rows: ["sedgwick", "insurance"],
  },
];
const landscapeName = (id: string) => LANDSCAPE.find((l) => l.id === id)?.name.replace(/,.*$/, "") ?? id;


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
  const e = errorRates();
  const money = moneyHeadline();
  const payout = MEASURED.items.find((i) => i.id === "payout")?.figure.replace(/ s$/, " seconds") ?? null;
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

      <section id="path" className="page-section" aria-labelledby="path-h">
        <h2 id="path-h">Start with a photo, then go further</h2>
        <p className="page-prose">
          The first step is the one the home page gives: <Link className="text-link" href="/try">Try a photo</Link>. The stops after it take about five minutes. A paid sandbox receipt, without sending a payout:{" "}
          <Link className="text-link" href={RECORDED_RECEIPT_URL}>
            the recorded receipt
          </Link>
          .
        </p>
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

      <div className="jr-head">
        <h2 className="sr-only">Results</h2>
        <Info id="evidence.results" label="" topic="The results" />
      </div>
      <Results />

      <div className="ev-folds">
        <p className="ev-folds-note muted">Each section below opens on a press; a link to any part of it opens it too.</p>

        <Fold id="errors" title="Error rates, on photos with a known answer" what={`${e.wrongPay.count} of ${e.wrongPay.of} paid when they should not have been; ${e.heldBack.count} of ${e.heldBack.of} held for a person or a new photo when they could have been paid, ${e.heldBack.of} decisions on ${e.heldBack.cases === 1 ? "one photo" : `${e.heldBack.cases} photos`}.`}>
          <p className="ev-fold-info">
            <Info id="evidence.errors" label="" topic="The error rates" />
          </p>
          <ErrorRates folded />
        </Fold>

        <Fold id="money" title="What changes, and what is at stake" what={`${money.total} in refunds at the lowest stated prices; ${money.range} of it goes unclaimed.`}>
          <p className="ev-fold-info">
            <Info id="evidence.money" label="" topic="What is at stake" />
          </p>
          <Contrast className="vs ev-vs" />
          <Money />
          <p className="page-note">
            Counted from the CPSC records and each recall&rsquo;s proof rule; pro-rated refunds and recalls that state no price are left out, not estimated.{" "}
            <Link className="text-link" href="/evidence/market#money">
              The method and the largest recalls
            </Link>
          </p>
        </Fold>

        <Fold id="network" title="One photo, two firms" what={`A photo already claimed at one firm is held at the next before any model call; only a hash and a row id cross. ${poolLimits().sentence}`}>
          <Network />
          <PoolLimits />
          <PoolTrust />
          <Suspense fallback={<HashPoolCall host={null} />}>
            <HashPoolCallLive />
          </Suspense>
          <HashReuse />
          <FraudDocket />
        </Fold>

        <Fold id="live-capture" title="A photo taken now" what="A recall setting that opens the camera instead of the photo library, and what it does and does not prove.">
          <p className="page-prose">
            A firm can set a recall to ask for a photo taken now. The claim page&rsquo;s photo button then opens the phone&rsquo;s rear camera (<code>capture=&quot;environment&quot;</code>), the photo library and the sample photo are not offered, and the claim
            records that the camera was asked for. It is off on the sample recalls, so a visitor on a laptop can try a saved photo.{" "}
            <Link className="text-link" href="/claim/BH-2026-01?capture=live">
              The claim page with it on
            </Link>
          </p>
          <p className="page-prose">
            <strong>What it does.</strong> On a phone, the photo is taken at the moment of the claim, so a picture saved from somewhere else is not one tap away. A recall administrator told the CPSC&rsquo;s 2026 docket on recall claims that it now often
            requires live capture (
            <a className="text-link" href={PROBLEM.adminComment.url} target="_blank" rel="noreferrer">
              {PROBLEM.adminComment.short}
            </a>
            ).
          </p>
          <p className="page-prose">
            <strong>What it does not prove.</strong> The browser treats <code>capture</code> as a request: a desktop browser may still show a file picker, and a camera can photograph a screen or a printout. It does not sign the image the way a capture
            attestation product does. So every photo still goes through the hash pool, the own-photo check&rsquo;s reading of screens and prints, and the other five checks, with the setting on or off.
          </p>
        </Fold>

        <Fold id="first" title="What is first here" what="Three things, each set beside the nearest existing thing, from its own page.">
          <p className="ev-fold-info">
            <Info id="evidence.first" label="" topic="What is first here" />
          </p>
          <ol className="ev-first">
            {FIRST.map((f, i) => (
              <li key={f.line} className="ev-first-item" data-ui>
                <span className="ev-first-n tabular" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <p className="ev-first-line">{f.line}</p>
                  <p className="ev-first-near">{f.near}</p>
                  <p className="jp-links">
                    {f.rows.map((id) => (
                      <Link key={id} className="text-link" href={`/evidence/market#land-${id}`}>
                        {landscapeName(id)}
                      </Link>
                    ))}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="page-note">
            Each comparison, with its source and date:{" "}
            <Link className="text-link" href="/evidence/market#compare">
              How it compares
            </Link>
            . The two-reviewer design and where it comes from:{" "}
            <Link className="text-link" href="/evidence/photo-checks#lineage">
              Photo checks
            </Link>
            .
          </p>
        </Fold>

        <Fold id="parts" title="Where each part lives" what="Checks and payment, the owner's screens, who it helps, three ideas, and sources and labels, each with the pages that show it.">
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
        </Fold>

        <Fold id="benchmark" title="Reading the remedy, measured" what={`Three readers took the same ${BENCH.variants.claude_selfcheck.n} real CPSC remedies, and each field was scored.`}>
          <p className="ev-fold-info">
            <Info id="evidence.benchmark" label="" topic="The extraction benchmark" />
          </p>
          <p className="page-prose jp-intro">Every check depends on reading the remedy right. Three readers took the same {BENCH.variants.claude_selfcheck.n} real CPSC remedies, and each field was scored.</p>
          <Benchmark />
        </Fold>

        <Fold id="photo-checks" title="The photo checks, recorded" what={`${free.caught} of ${free.total} photos that needed a closer look stopped by code before any AI call.`}>
          <p className="ev-fold-info">
            <Info id="evidence.fixtures" label="" topic="The photo checks" />
          </p>
          <p className="page-prose jp-intro tabular">
            Before any AI call, {free.caught} of {free.total} recorded photos that needed a closer look were stopped by code: {free.retake} asked for a new photo (the recall&rsquo;s own pictures, turned and cropped copies, another recall&rsquo;s picture, a blurry
            photo) and {free.firmReview === 1 ? "one photo already used on an earlier claim went" : `${free.firmReview} photos already used went`} to a person at the firm. {hashSpeed().sentence} Reading the CPSC&rsquo;s own photos with that match off, the model was right on {ra.right} of {ra.readings} readings.
          </p>
          <p className="page-prose">
            <Link className="text-link" href="/evidence/photo-checks">
              Every recorded run, the model settings compared, and what the model read
            </Link>
          </p>
        </Fold>

        <Fold id="never" title="What the AI never decides" what="Whether to pay, how much and by which route are decided in code; the claim limits, in plain rules.">
          <p className="ev-fold-info">
            <Info id="evidence.never" label="" topic="What the AI never decides" />
          </p>
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
        </Fold>

        <Fold id="measured" title="Measured in the sandbox" what={`A photo check takes ${checkTimeWords().short}; a PayPal payout ${payout ?? "seconds"} after approval.`}>
          <p className="page-prose jp-intro">Timings from the owner&rsquo;s claim flow, run end to end against the PayPal sandbox.</p>
          <Measured />
        </Fold>

        <Fold id="tested" title="How it is tested" what="The suites behind every page, counted when they last ran.">
          <Tested />
        </Fold>

        <Fold id="data" title="The data" what={`${fmtInt(S.recalls.count)} recalls from the CPSC Recalls API, pulled ${fmtDate(S.pulledAt.slice(0, 10))}, and how each one is counted.`}>
          <p className="page-prose">
            Every figure comes from the CPSC Recalls API, pulled {fmtDate(S.pulledAt.slice(0, 10))}: {fmtInt(S.recalls.count)} recalls from {fmtDate(S.range.from)} to {fmtDate(S.range.to)}. A recall counts as a photo refund when its remedy text mentions a photo, picture or image and a refund ({fmtInt(S.all.photoRefund.count)}). The headline then reads each one&rsquo;s proof rule: {fmtInt(HEADLINE.count)} ask for a photo of the product made safe and pay a refund in money for it.
          </p>
          <p className="page-note">Run on the earlier snapshot behind our research note (1,227 recalls to October 29), the same classifier gives the same 523 photo-refund recalls.</p>
          <p className="page-prose">
            <Link className="text-link" href="/learn#data">
              The method, with every definition
            </Link>
          </p>
        </Fold>

        <Fold id="research" title="Grounded in research" what="Published findings Remedy is built on, each with what Remedy does about it.">
          <p className="ev-fold-info">
            <Info id="evidence.research" label="" topic="The research behind Remedy" />
          </p>
          <Research />
        </Fold>

        <Fold id="more" title="More evidence" what="Every photo check recorded; cost, load and running it for real; what is at stake and who runs it first.">
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
        </Fold>
      </div>
    </div>
  );
}
