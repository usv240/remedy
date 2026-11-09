import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getRecall, publicRecall } from "@/app/api/claims/_lib/recall";
import { getPreset, readRecorded, runPreset, type PresetRun } from "@/app/api/try/_lib/presets";
import { TRY_PAYOUT } from "@/app/api/try/_lib/sandbox-payout";
import { Checking } from "@/components/claim/Checking";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { RecallCard } from "@/components/claim/RecallCard";
import { Result } from "@/components/claim/Result";
import { SANDBOX_LABEL } from "@/lib/payments/deps";
import "../../../pages.css";
import "@/components/claim/claim.css";
import "@/components/try/try.css";

type Params = { params: Promise<{ id: string }> };

/** The same words and times /try and the home page use: a recorded answer shows its own recorded run's time. */
const sourceOf = (r: PresetRun) => (r.replay.used ? "recorded" : "code") as "recorded" | "code";
const recordedOf = (r: PresetRun) =>
  r.replay.used && r.replay.ms_when_recorded && r.replay.total_ms_when_recorded ? { totalMs: r.replay.total_ms_when_recorded, visionMs: r.replay.ms_when_recorded.vision, reviewersMs: r.replay.ms_when_recorded.reviewers } : null;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const p = getPreset(id);
  return { title: p ? `${p.title}, an example` : "Example" };
}

async function Preset({ params }: Params) {
  const { id } = await params;
  const p = getPreset(id);
  if (!p) notFound();
  const r = getRecall(p.recall);
  if (!r) notFound();
  const run = await runPreset(p);
  const tech = p.technical && readRecorded(p.technical.recorded) ? await runPreset(p, { technical: true }) : null;
  const recorded = readRecorded(p.recorded);
  return (
    <>
      <p className="cl-crumbs" data-ui>
        <Link className="text-link" href="/try">
          All examples
        </Link>
      </p>
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title tr-title">{p.title}</h1>
          <ClaimInfo k="try.presets" topic="ready-made examples" />
        </div>
        <p className="lede">{p.summary}</p>
      </header>

      <div className="tr-preset">
        <div className="tr-preset-top">
          {/* eslint-disable-next-line @next/next/no-img-element -- the preset's own photo */}
          <img className="tr-preset-img" src={`/api/try/presets/${p.id}/photo`} alt={p.photo_alt} width={112} height={112} />
          <div className="tr-preset-text">
            <p className="tr-preset-expect">
              <strong>Expected.</strong> {p.expected.plain}
            </p>
            <p className="tr-credit">{p.photo_credit}</p>
          </div>
        </div>
        <div className="tr-preset-actions">
          <a className="btn btn-quiet" href={`/api/try/presets/${p.id}`} download>
            Download JSON
          </a>
          <a className="btn btn-quiet" href={`/api/try/presets/${p.id}/photo?download=1`} download>
            Download the photo
          </a>
        </div>
        <Checking
          checks={run.result.checks}
          stage="done"
          elapsedMs={run.result.timings?.total_ms ?? 0}
          technical={run.result.timings}
          reviewersAgreed={run.result.decision === "verified" && run.result.decided_by === "reviewers"}
          source={sourceOf(run)}
          recorded={recordedOf(run)}
        />
        <Result
          claim={run.result}
          ctx={{ action: null, word: null, example: null }}
          preview
          previewNote={
            p.id === TRY_PAYOUT.preset && run.result.decision === "verified" ? (
              <>
                Checked, and nothing is paid yet: on the Try page this example sends its refund as a real PayPal sandbox payout.{" "}
                <Link className="text-link" href={`/try#preset-${p.id}`}>
                  Send it from the Try page
                </Link>
              </>
            ) : undefined
          }
        />
        <p className="cl-hint">
          {run.replay.used
            ? `Claude's answer is from one recorded live run of ${run.replay.model} on ${run.replay.recorded_at?.slice(0, 10)}; every check around it ran again in code when this page loaded.`
            : "No model call was needed: this answer was found in code, live, when this page loaded."}
        </p>
        {tech && p.technical && (
          <div className="tr-techrun cl-tech">
            <p className="cl-hint">{p.technical.note}</p>
            <Checking checks={tech.result.checks} stage="done" elapsedMs={tech.result.timings?.total_ms ?? 0} technical={tech.result.timings} source={sourceOf(tech)} recorded={recordedOf(tech)} />
          </div>
        )}
        {recorded?.vision && (
          <details className="cl-tech cl-remedy">
            <summary>The recorded model answer</summary>
            <pre className="tr-json">{JSON.stringify(recorded.vision.report, null, 2)}</pre>
          </details>
        )}
      </div>

      <section className="page-section" aria-labelledby="pr-recall">
        <h2 id="pr-recall">The recall it was checked against</h2>
        <div className="app-sheet">
          <RecallCard recall={publicRecall(r)} />
        </div>
      </section>
      <p className="page-note">{SANDBOX_LABEL} Running a ready-made example pays nothing by itself; the verified sample charger sends its sandbox payout from the Try page.</p>
    </>
  );
}

export default function PresetPage({ params }: Params) {
  return (
    <div className="page frame tr-preset-page">
      <Suspense fallback={<p className="page-loading">Loading the example</p>}>
        <Preset params={params} />
      </Suspense>
    </div>
  );
}
