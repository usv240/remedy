"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ClaimView } from "@/app/api/claims/_lib/types";
import { Checking } from "@/components/claim/Checking";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { Result } from "@/components/claim/Result";

export type PresetCard = {
  id: string;
  title: string;
  summary: string;
  recall: string;
  photo_alt: string;
  photo_credit: string;
  expected: { decision?: string; decided_by?: string; checks?: Record<string, string>; plain: string };
  technical: { note: string } | null;
  user: boolean;
};

type Run = { result: ClaimView; replay: { used: boolean; recorded_at: string | null; model: string | null; cost_usd_when_recorded: number | null } };

const EXPECT: Record<string, string> = { verified: "Verified", retake: "Retake", firm_review: "Firm review" };

function PresetRow({ p }: { p: PresetCard }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [run, setRun] = useState<Run | null>(null);
  const [tech, setTech] = useState<Run | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const out = useRef<HTMLDivElement>(null);

  async function go(technical = false) {
    setState("running");
    const t0 = performance.now();
    try {
      const r = await fetch(`/api/try/presets/${p.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technical }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message);
      setElapsed(performance.now() - t0);
      if (technical) setTech(j.data);
      else setRun(j.data);
      setState("done");
      requestAnimationFrame(() => out.current?.focus());
    } catch {
      setState("error");
    }
  }

  return (
    <li className="tr-preset">
      <div className="tr-preset-top">
        {/* eslint-disable-next-line @next/next/no-img-element -- the preset's own photo, served by the API */}
        <img className="tr-preset-img" src={`/api/try/presets/${p.id}/photo`} alt={p.photo_alt} width={112} height={112} loading="lazy" />
        <div className="tr-preset-text">
          <h3 className="tr-preset-title">{p.title}</h3>
          <p className="tr-preset-sum">{p.summary}</p>
          <p className="tr-preset-expect">
            {p.expected.decision && (
              <span className="pill" data-tone={p.expected.decision === "verified" ? "positive" : p.expected.decision === "retake" ? "attention" : "info"}>
                Expected: {EXPECT[p.expected.decision] ?? p.expected.decision}
              </span>
            )}{" "}
            {p.expected.plain}
          </p>
          <p className="tr-credit">{p.photo_credit}</p>
        </div>
      </div>
      <div className="tr-preset-actions">
        <button type="button" className="btn btn-ink tr-run" onClick={() => void go(false)} disabled={state === "running"}>
          {state === "running" ? "Running" : run ? "Run it again" : "Run it"}
        </button>
        <Link className="text-link" href={`/try/presets/${p.id}`}>
          Full result
        </Link>
        <a className="text-link" href={`/api/try/presets/${p.id}`} download>
          Download JSON
        </a>
        <a className="text-link" href={`/api/try/presets/${p.id}/photo?download=1`} download>
          Download photo
        </a>
      </div>
      {state === "error" && (
        <p className="cl-error" role="alert">
          This example could not run just now. Please try again.
        </p>
      )}
      <div ref={out} tabIndex={-1} className="tr-out" aria-live="polite">
        {state === "running" && !run && <Checking checks={null} stage="stored" elapsedMs={0} />}
        {run && (
          <>
            <Checking checks={run.result.checks} stage="done" elapsedMs={run.result.timings?.total_ms ?? elapsed} technical={run.result.timings} />
            <Result claim={run.result} ctx={{ action: null, word: null, example: null }} preview />
            <p className="cl-tech cl-hint">
              {run.replay.used
                ? `The model's answer is replayed from one live run of ${run.replay.model} on ${run.replay.recorded_at?.slice(0, 10)} (it cost $${run.replay.cost_usd_when_recorded}); every check around it ran again in code just now.`
                : "No model call was needed: this answer was found in code, live, just now."}
            </p>
            {p.technical && (
              <div className="tr-techrun cl-tech">
                <p className="cl-hint">{p.technical.note}</p>
                <button type="button" className="btn btn-quiet" onClick={() => void go(true)} disabled={state === "running"}>
                  Run with the official-image match off
                </button>
                {tech && <Checking checks={tech.result.checks} stage="done" elapsedMs={tech.result.timings?.total_ms ?? 0} technical={tech.result.timings} />}
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function Presets({ presets, user }: { presets: PresetCard[]; user: PresetCard[] }) {
  return (
    <div className="tr-presets">
      <p className="tr-intro">
        Real photos through the real checks. Nothing is paid. <ClaimInfo k="try.presets" topic="ready-made examples" />
      </p>
      <ul className="tr-preset-list">
        {presets.map((p) => (
          <PresetRow key={p.id} p={p} />
        ))}
      </ul>
      <h3 className="tr-sub">Photos of products made safe</h3>
      {user.length ? (
        <ul className="tr-preset-list">
          {user.map((p) => (
            <PresetRow key={p.id} p={p} />
          ))}
        </ul>
      ) : (
        <p className="cl-note tr-more">More examples coming: photos of products the team owns, made safe and checked against their recalls.</p>
      )}
    </div>
  );
}
