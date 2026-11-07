"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ClaimView } from "@/app/api/claims/_lib/types";
import type { RecordedSample } from "@/app/api/try/_lib/presets";
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
const toneOf = (d: string) => (d === "verified" ? "positive" : d === "retake" ? "attention" : "info");
const CHECK_NAME: Record<string, string> = { C1: "right product", C2: "made safe", C3: "your own photo", C4: "within the recall", C5: "claim limits", C6: "not already refunded" };
const STATUS_WORD: Record<string, string> = { pass: "passes", fail: "does not pass", unclear: "is unclear", skipped: "is not checked" };
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

/** How a run compares with the example's expected result: the decision, and every check the example names. */
function againstExpected(p: PresetCard, r: ClaimView): { ok: boolean; line: string } | null {
  const e = p.expected;
  if (!e.decision) return null;
  const misses = [
    r.decision !== e.decision ? `the decision is ${EXPECT[r.decision ?? ""] ?? r.decision}, not ${EXPECT[e.decision] ?? e.decision}` : null,
    e.decided_by && r.decided_by !== e.decided_by ? `it was decided by ${r.decided_by}, not ${e.decided_by}` : null,
    ...Object.entries(e.checks ?? {}).map(([id, want]) => {
      const got = r.checks.find((c) => c.id === id)?.status;
      return got === want ? null : `${CHECK_NAME[id] ?? id} ${STATUS_WORD[got ?? ""] ?? got}`;
    }),
  ].filter(Boolean);
  const named = Object.entries(e.checks ?? {}).map(([id, want]) => `${CHECK_NAME[id] ?? id} ${STATUS_WORD[want] ?? want}`);
  return misses.length
    ? { ok: false, line: `Different from the expected result: ${misses.join("; ")}.` }
    : { ok: true, line: `As expected: ${EXPECT[e.decision] ?? e.decision}${named.length ? `, and ${named.join(", ")}` : ""}.` };
}

function Expected({ e }: { e: PresetCard["expected"] }) {
  return (
    <p className="tr-preset-expect">
      {e.decision && (
        <span className="pill" data-tone={toneOf(e.decision)}>
          Expected: {EXPECT[e.decision] ?? e.decision}
        </span>
      )}{" "}
      {e.plain}
    </p>
  );
}

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

  const vs = run ? againstExpected(p, run.result) : null;
  return (
    <li className="tr-preset">
      <div className="tr-preset-top">
        {/* eslint-disable-next-line @next/next/no-img-element -- the preset's own photo, served by the API */}
        <img className="tr-preset-img" src={`/api/try/presets/${p.id}/photo`} alt={p.photo_alt} width={112} height={112} loading="lazy" />
        <div className="tr-preset-text">
          <h4 className="tr-preset-title">{p.title}</h4>
          <p className="tr-preset-sum">{p.summary}</p>
          <Expected e={p.expected} />
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
            <Checking checks={run.result.checks} stage="done" elapsedMs={run.result.timings?.total_ms ?? elapsed} technical={run.result.timings} reviewersAgreed={run.result.decision === "verified" && run.result.decided_by === "reviewers"} />
            <Result claim={run.result} ctx={{ action: null, word: null, example: null }} preview />
            {vs && (
              <p className="tr-vs" data-ok={vs.ok ? "" : undefined}>
                {vs.line}
              </p>
            )}
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

/** A photo shown with its recorded results: the measured runs at the claim path's own setting, against its known answer. */
function RecordedRow({ s }: { s: RecordedSample }) {
  const r = s.recorded;
  const all = r.matching === r.runs;
  return (
    <li className="tr-preset">
      <div className="tr-preset-top">
        {/* eslint-disable-next-line @next/next/no-img-element -- a sample photo served from /public */}
        <img className="tr-preset-img" src={s.thumb} alt={s.photo_alt} width={112} height={112} loading="lazy" />
        <div className="tr-preset-text">
          <h4 className="tr-preset-title">{s.title}</h4>
          <p className="tr-preset-sum">{s.summary}</p>
          <Expected e={s.expected} />
          <p className="tr-credit">{s.photo_credit}</p>
        </div>
      </div>
      <div className="tr-recorded">
        <p className="tr-recorded-line">
          <span className="pill" data-tone={toneOf(r.decision)}>
            Recorded: {EXPECT[r.decision] ?? r.decision}
          </span>{" "}
          {all ? `In all ${r.runs} measured runs, ` : `In ${r.matching} of ${r.runs} measured runs, `}
          {r.decided_by === "made_safe" ? "the made-safe check saw the cord still attached and asked for it to be cut first. Nothing was paid." : `the decision was ${EXPECT[r.decision] ?? r.decision}. Nothing was paid.`}
        </p>
        <p className="cl-tech cl-hint">
          C2: {r.reason_technical} Measured with {r.model}
          {r.effort ? ` at ${r.effort} effort` : ""}, the claim path&rsquo;s own setting, on {day(r.ran_at)} (content/verify/sweep-sample.json). Nothing runs when this page opens.
        </p>
      </div>
    </li>
  );
}

export function Presets({ madeSafe, recorded, others, user }: { madeSafe: PresetCard[]; recorded: RecordedSample[]; others: PresetCard[]; user: PresetCard[] }) {
  return (
    <div className="tr-presets">
      <p className="tr-intro">
        Real photos through the real checks. Nothing is paid. <ClaimInfo k="try.presets" topic="ready-made examples" />
      </p>
      <h3 className="tr-sub">Photos of products made safe</h3>
      <p className="tr-sub-lede">
        One real charger, photographed before and after its cord was cut. Brightline Home&rsquo;s sample recall asks for the cord to be cut, so the cut cord is verified, and on a real claim refunded at once, while the charger
        opened up with its cord still attached is asked again.
      </p>
      <ul className="tr-preset-list">
        {madeSafe.map((p) => (
          <PresetRow key={p.id} p={p} />
        ))}
        {recorded.map((s) => (
          <RecordedRow key={s.id} s={s} />
        ))}
        {user.map((p) => (
          <PresetRow key={p.id} p={p} />
        ))}
      </ul>
      <h3 className="tr-sub">Photos that are asked for again</h3>
      <p className="tr-sub-lede">A recall&rsquo;s own picture, a copy, a blurry photo, a look-alike or another product: each gets a kind answer saying what to send instead, and nothing is paid.</p>
      <ul className="tr-preset-list">
        {others.map((p) => (
          <PresetRow key={p.id} p={p} />
        ))}
      </ul>
    </div>
  );
}
