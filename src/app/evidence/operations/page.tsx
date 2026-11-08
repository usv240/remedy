import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { extraction } from "@/components/judges/data";
import { Load, Real } from "@/components/judges/Load";
import { fmtInt } from "@/lib/api/format";
import "../../pages.css";
import "../../landing-shared.css";
import "../../ops/ops.css";
import "../evidence.css";

export const metadata: Metadata = { title: "Cost and operations", description: "How each AI check stays cheap, one hundred visitors at once, and what a production deployment changes." };

const COST = [
  { what: "Identical requests replay", how: "A request that matches one already answered (same model, prompt, images and settings) is read back from a local cache in test runs instead of paid for again." },
  { what: "An identical photo reuses its result", how: "The same claim photo for the same recall and rule reuses its checked result from the database, with no new AI call." },
  { what: "Images are downscaled", how: "Photos and official images are shrunk before the vision call: up to 16% fewer input tokens on large photos, measured by the verification builder." },
  { what: "The recall's part is cached", how: "Each request puts the recall's data and official images first, so repeat checks on one recall read that part from Claude's prompt cache." },
  { what: "A daily spend cap", how: "The hosted site keeps to a daily AI budget. Past it, every free check still runs and a person at the firm looks at the rest." },
];

/** /evidence/operations: the AI cost, the load test and the operating range, moved off /evidence to keep it short. */
export default function OperationsPage() {
  const ex = extraction();
  return (
    <div className="page frame evidence">
      <OpenOnHash />
      <header className="page-head">
        <p className="ev-back">
          <Link className="text-link" href="/evidence#more">
            Evidence
          </Link>
        </p>
        <h1 className="page-title">Cost and operations</h1>
        <p className="lede">What each check costs, how the free paths hold up under load, and what a production deployment changes.</p>
      </header>

      <section id="cost" className="page-section" aria-labelledby="cost-h">
        <div className="title-row">
          <h2 id="cost-h">AI cost, kept small</h2>
          <Info id="status.ai_spend" label="" topic="AI spend" />
        </div>
        <p className="page-prose jp-intro tabular">
          Reading all {fmtInt(ex.counts.recalls)} remedies cost ${ex.usage.usd.toFixed(2)} in one batch run. Each photo check is one vision call, and only when the free checks pass.
        </p>
        <ul className="jc">
          {COST.map((c) => (
            <li key={c.what}>
              <p className="jc-what">{c.what}</p>
              <p className="jc-how">{c.how}</p>
            </li>
          ))}
        </ul>
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
          What the demo runs on today, and what a production deployment changes. Live health is on{" "}
          <Link className="text-link" href="/ops">
            Operations
          </Link>
          .
        </p>
        <Real />
      </section>
    </div>
  );
}
