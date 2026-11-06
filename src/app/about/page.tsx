import type { Metadata } from "next";
import Link from "next/link";
import credits from "../../../content/verify/fixtures/credits.json";
import { Info } from "@/components/Info";
import "../pages.css";
import "./about.css";

export const metadata: Metadata = { title: "About", description: "What Remedy is and is not, and how it labels what is real and what is a sample." };

const IS = [
  "A way to pay recall refunds the moment a photo of the product made safe is verified, through PayPal.",
  "Built on the CPSC's public recall data: every US consumer product recall since January 2024.",
  "A tool a recalling firm runs with its own PayPal account. The refund comes from the firm; Remedy never holds the money.",
  "Open source under the MIT license, built for the PayPal AI Hackathon, November 2026.",
];

const IS_NOT = [
  "Not part of the CPSC, and not affiliated with it. It uses the CPSC's public data and helps firms prepare the reports the CPSC asks for.",
  "Not affiliated with any recalling firm or retailer shown on this site.",
  "Not live money. Every payout, refund and order on this site runs in the PayPal sandbox.",
  "Not a final say on a claim. Unclear photos go to two AI reviewers and then a person at the firm.",
];

const LABELS = [
  { what: "Recalls", how: "Real CPSC recalls, with their real data and the CPSC's own images, credited." },
  { what: "Proof rules", how: "Read from each official remedy by Claude Opus 5.5 with a self-check. The official text is always shown beside the rule." },
  { what: "Brightline Home", how: "A fictional sample firm, so the firm console has something to show. Its claims are sample history." },
  { what: "Payouts", how: "Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm." },
  { what: "Sample photos", how: "The CPSC's own images and copies made from them, and one CC0 photo from Wikimedia Commons. Each is listed below." },
];

export default function AboutPage() {
  const photos = credits.files.filter((f) => f.file.startsWith("official/") || f.file.startsWith("other/"));
  return (
    <div className="page frame">
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">About Remedy</h1>
          <Info id="page.about" />
        </div>
        <p className="lede">Remedy pays recall refunds the moment a photo of the product made safe is verified, through PayPal, so recalled products leave homes faster.</p>
      </header>

      <section className="page-section" aria-labelledby="is-h">
        <h2 id="is-h">What Remedy is</h2>
        <ul className="about-list">
          {IS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section className="page-section" aria-labelledby="not-h">
        <h2 id="not-h">What Remedy is not</h2>
        <ul className="about-list">
          {IS_NOT.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section id="labels" className="page-section" aria-labelledby="labels-h">
        <h2 id="labels-h">What is real and what is a sample</h2>
        <dl className="about-labels">
          {LABELS.map((l) => (
            <div key={l.what}>
              <dt>{l.what}</dt>
              <dd>{l.how}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="page-section" aria-labelledby="more-h">
        <h2 id="more-h">Read more</h2>
        <ul className="page-links">
          <li>
            <Link className="text-link" href="/learn">
              How recalls work
            </Link>
            <span className="muted"> and how every number was counted</span>
          </li>
          <li>
            <Link className="text-link" href="/judges">
              For judges
            </Link>
            <span className="muted"> the five-minute path and the results</span>
          </li>
          <li>
            <Link className="text-link" href="/stack">
              How it is built
            </Link>
            <span className="muted"> every tool and its job</span>
          </li>
        </ul>
      </section>

      <section id="credits" className="page-section" aria-labelledby="credits-h">
        <h2 id="credits-h">Credits</h2>
        <ul className="credits-list">
          <li>Recall data and images: U.S. Consumer Product Safety Commission, public domain (US government works).</li>
          {photos.map((f) => (
            <li key={f.file}>
              {"title" in f && f.title ? `${f.title}: ${f.credit}, ${f.licence}.` : `${f.caption ?? f.file} (recall ${"recall" in f ? f.recall : ""}): ${f.credit}.`}
            </li>
          ))}
          <li>The made-safe example photos on the home page: CPSC, recalls 26125 (a hair dryer with its cord cut) and 25007 (a helmet with its straps cut off).</li>
          <li>Sentient by Indian Type Foundry, under the ITF Free Font License.</li>
          <li>IBM Plex Sans by IBM, under the SIL Open Font License.</li>
          <li>Built for the PayPal AI Hackathon, November 2026. Open source under the MIT license.</li>
        </ul>
      </section>
    </div>
  );
}
