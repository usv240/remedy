"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ClaimView } from "@/app/api/claims/_lib/types";
import type { RecordedSample } from "@/app/api/try/_lib/presets";
import { Checking, type AnswerSource, type RecordedTimes } from "@/components/claim/Checking";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { Result } from "@/components/claim/Result";
import { SandboxPay } from "./SandboxPay";

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
  /** This example can also run live against the model, once a day per visitor (Brightline's sample charger). */
  live?: boolean;
  /** Once verified, this example can send a real PayPal sandbox payout to the sandbox buyer (Brightline's sample charger). */
  pay?: { amount: string; payee: string | null } | null;
};

type Run = {
  result: ClaimView;
  replay: { used: boolean; recorded_at: string | null; model: string | null; cost_usd_when_recorded: number | null; ms_when_recorded?: { vision: number; reviewers: number } | null; total_ms_when_recorded?: number | null };
  live?: { ran: boolean; note: string | null; usd: number | null; model: string | null } | null;
};

const EXPECT: Record<string, string> = { verified: "Verified", retake: "Retake", firm_review: "Firm review" };
const toneOf = (d: string) => (d === "verified" ? "positive" : d === "retake" ? "attention" : "info");
const CHECK_NAME: Record<string, string> = { C1: "right product", C2: "made safe", C3: "your own photo", C4: "within the recall", C5: "claim limits", C6: "not already refunded" };
const STATUS_WORD: Record<string, string> = { pass: "passes", fail: "does not pass", unclear: "is unclear", skipped: "is not checked" };
/** Where a run's answer came from, and a recorded run's own times, in the words every page uses (src/lib/time-words.ts). */
const sourceOf = (r: Run): AnswerSource => (r.live?.ran ? "live" : r.replay.used ? "recorded" : "code");
const recordedOf = (r: Run): RecordedTimes | null =>
  r.replay.used && r.replay.ms_when_recorded && r.replay.total_ms_when_recorded ? { totalMs: r.replay.total_ms_when_recorded, visionMs: r.replay.ms_when_recorded.vision, reviewersMs: r.replay.ms_when_recorded.reviewers } : null;
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

/** The example's expected result: a check on the harness, so it shows in the Technical view only. */
function Expected({ e }: { e: PresetCard["expected"] }) {
  return (
    <p className="tr-preset-expect cl-tech">
      {e.decision && (
        <span className="pill" data-tone={toneOf(e.decision)}>
          Expected: {EXPECT[e.decision] ?? e.decision}
        </span>
      )}{" "}
      {e.plain}
    </p>
  );
}

/**
 * Whether the list lays its cards out side by side. Then a result opens full width below the cards (in `slot`) instead
 * of inside a 24rem card; on a phone, one card wide, it opens inside its card as before.
 */
function useSideBySide(list: RefObject<HTMLUListElement | null>) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => setWide(getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length > 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list]);
  return wide;
}

function PresetRow({ p, slot, open, onOpen }: { p: PresetCard; slot: HTMLElement | null; open: boolean; onOpen: (id: string) => void }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [run, setRun] = useState<Run | null>(null);
  const [tech, setTech] = useState<Run | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const out = useRef<HTMLDivElement>(null);
  const runBtn = useRef<HTMLButtonElement>(null);

  /** Back from the full-width result to this example's card, with focus on its Run button. */
  function back() {
    const btn = runBtn.current;
    if (!btn) return;
    btn.focus({ preventScroll: true });
    btn.closest("li")?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  async function go(technical = false, live = false) {
    onOpen(p.id);
    setState("running");
    const t0 = performance.now();
    try {
      const r = await fetch(`/api/try/presets/${p.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technical, live }) });
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
  const panelShown = Boolean(slot && open && (run || state === "running"));
  // The checks on the left, the answer and what to do with it on the right, when there is room; one column on a phone.
  const body = (
    <>
      {state === "running" && !run && <Checking checks={null} stage="stored" elapsedMs={0} />}
      {run && (
        <div className="tr-out-grid">
          <div className="tr-out-checks">
            <Checking
              checks={run.result.checks}
              stage="done"
              elapsedMs={run.result.timings?.total_ms ?? elapsed}
              technical={run.result.timings}
              reviewersAgreed={run.result.decision === "verified" && run.result.decided_by === "reviewers"}
              source={sourceOf(run)}
              recorded={recordedOf(run)}
            />
          </div>
          <div className="tr-out-answer">
            <Result claim={run.result} ctx={{ action: null, word: null, example: null }} preview previewNote={p.pay && run.result.decision === "verified" ? "Checked, and nothing is paid yet: send the refund below as a real PayPal sandbox payout." : undefined} />
            {p.pay && run.result.decision === "verified" && <SandboxPay amount={p.pay.amount} payee={p.pay.payee} />}
            {vs && (
              <p className="tr-vs cl-tech" data-ok={vs.ok ? "" : undefined}>
                {vs.line}
              </p>
            )}
            {run.live && (
              <p className="tr-live" data-ran={run.live.ran ? "" : undefined}>
                {run.live.ran ? (
                  <>
                    <span className="pill" data-tone="positive">
                      Live
                    </span>{" "}
                    {run.live.model ?? "Claude"} read this photo just now{run.live.usd !== null ? `, for $${run.live.usd.toFixed(4)} from today's AI budget` : ""}. Nothing is paid unless you send the sandbox payout below.
                  </>
                ) : (
                  <>
                    <span className="pill" data-tone="info">
                      Recorded
                    </span>{" "}
                    {run.live.note}
                  </>
                )}
              </p>
            )}
            <p className="cl-tech cl-hint">
              {run.live?.ran
                ? "The model's answer is new: the verification cache was skipped for this run, and every check around it ran in code."
                : run.replay.used
                ? `The model's answer is from one recorded live run of ${run.replay.model} on ${run.replay.recorded_at?.slice(0, 10)} (it cost $${run.replay.cost_usd_when_recorded}); every check around it ran again in code just now.`
                : "No model call was needed: this answer was found in code, live, just now."}
            </p>
            {p.technical && (
              <div className="tr-techrun cl-tech">
                <p className="cl-hint">{p.technical.note}</p>
                <button type="button" className="btn btn-quiet" onClick={() => void go(true)} disabled={state === "running"}>
                  Run with the official-image match off
                </button>
                {tech && <Checking checks={tech.result.checks} stage="done" elapsedMs={tech.result.timings?.total_ms ?? 0} technical={tech.result.timings} source={sourceOf(tech)} recorded={recordedOf(tech)} />}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
  return (
    <li className="tr-preset" id={`preset-${p.id}`} data-open={panelShown ? "" : undefined}>
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
        <button ref={runBtn} type="button" className="btn btn-ink tr-run" onClick={() => void go(false)} disabled={state === "running"} aria-controls={slot ? (panelShown ? `tr-result-${p.id}` : undefined) : `tr-out-${p.id}`}>
          {state === "running" ? "Running" : run ? "Run it again" : "Run it"}
        </button>
        {p.live && (
          <button type="button" className="btn btn-quiet tr-run-live" onClick={() => void go(false, true)} disabled={state === "running"}>
            Run it live
          </button>
        )}
        <Link className="text-link" href={`/try/presets/${p.id}`}>
          Full result
        </Link>
        <a className="text-link cl-tech" href={`/api/try/presets/${p.id}`} download>
          Download JSON
        </a>
        <a className="text-link" href={`/api/try/presets/${p.id}/photo?download=1`} download>
          Download photo
        </a>
        {slot && run && !open && (
          <button
            type="button"
            className="cl-textbtn tr-show"
            onClick={() => {
              onOpen(p.id);
              requestAnimationFrame(() => out.current?.focus());
            }}
          >
            Show the result
          </button>
        )}
      </div>
      {panelShown && (
        <p className="tr-open-note muted" aria-hidden="true">
          The result is open below the examples.
        </p>
      )}
      {state === "error" && (
        <p className="cl-error" role="alert">
          This example could not run just now. Please try again.
        </p>
      )}
      {slot
        ? panelShown &&
          createPortal(
            <section className="tr-result" id={`tr-result-${p.id}`} aria-labelledby={`tr-result-h-${p.id}`}>
              <div className="tr-result-head">
                <h4 id={`tr-result-h-${p.id}`} className="tr-result-title">
                  {p.title}
                </h4>
                <button type="button" className="btn btn-quiet tr-back" onClick={back}>
                  Back to the examples
                </button>
              </div>
              <div ref={out} tabIndex={-1} className="tr-out" aria-live="polite">
                {body}
              </div>
            </section>,
            slot,
          )
        : (
          <div ref={out} id={`tr-out-${p.id}`} tabIndex={-1} className="tr-out" aria-live="polite">
            {body}
          </div>
        )}
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

type Item = { kind: "preset"; p: PresetCard } | { kind: "recorded"; s: RecordedSample };

/**
 * One group of examples. Side by side, a result opens full width under the group (one at a time, focus moved to it,
 * with a way back to its card); one card wide, it opens inside its card.
 */
function ExampleList({ items }: { items: Item[] }) {
  const list = useRef<HTMLUListElement>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const wide = useSideBySide(list);
  return (
    <>
      <ul ref={list} className="tr-preset-list">
        {items.map((it) => (it.kind === "preset" ? <PresetRow key={it.p.id} p={it.p} slot={wide ? slot : null} open={openId === it.p.id} onOpen={setOpenId} /> : <RecordedRow key={it.s.id} s={it.s} />))}
      </ul>
      <div ref={setSlot} className="tr-slot" />
    </>
  );
}

export function Presets({ madeSafe, recorded, others, user }: { madeSafe: PresetCard[]; recorded: RecordedSample[]; others: PresetCard[]; user: PresetCard[] }) {
  const first: Item[] = [...madeSafe.map((p) => ({ kind: "preset" as const, p })), ...recorded.map((s) => ({ kind: "recorded" as const, s })), ...user.map((p) => ({ kind: "preset" as const, p }))];
  return (
    <div className="tr-presets">
      <p className="tr-intro">
        Real photos through the real checks. Running one pays nothing; the verified sample charger can send its refund as a sandbox payout. <ClaimInfo k="try.presets" topic="ready-made examples" />
      </p>
      <h3 className="tr-sub">Photos of products made safe</h3>
      <p className="tr-sub-lede">
        One real charger, photographed before and after its cord was cut. Brightline Home&rsquo;s sample recall asks for the cord to be cut, so the cut cord is verified and its refund can be sent, while the charger opened up
        with its cord still attached is asked again.
      </p>
      <ExampleList items={first} />
      <h3 className="tr-sub">Photos that are asked for again</h3>
      <p className="tr-sub-lede">A recall&rsquo;s own picture, a copy, a blurry photo, a look-alike or another product: each gets a kind answer saying what to send instead, and nothing is paid. Most run against the real CPSC recall 27056, the HAIARA power bank, with their recorded answers.</p>
      <ExampleList items={others.map((p) => ({ kind: "preset" as const, p }))} />
    </div>
  );
}
