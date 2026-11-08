"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtMs } from "@/lib/api/format";
import { scoreLine, settledLine } from "@/components/claim/format";

export type PanelCheck = { id: string; name: string; status: string; score: number | null; reason: string; technical: string };
export type PanelRun = {
  id: string;
  /** The tab's short label. */
  pick: string;
  title: string;
  about: string;
  thumb: string;
  thumbW: number;
  thumbH: number;
  credit: string;
  /** "Sample recall BH-2026-01" or "CPSC recall 27056", and the recall's short title. */
  recall: { label: string; title: string };
  decision: "verified" | "retake" | "firm_review";
  /** Verified by the two AI reviewers agreeing: an unsure check they settled reads as confirmed by them. */
  reviewersSettled: boolean;
  next: string;
  /** More on how it was decided, one tap away: the timings, for a verified run. */
  more?: string | null;
  totalMs: number;
  settings: string | null;
  checks: PanelCheck[];
  /** What PayPal does next, for a verified run. */
  paid: { line: string; note: string; more?: string | null; href: string; cta: string } | null;
};

/** The same words the owner's claim page uses for each result (src/components/claim/format.ts), with Unclear kept. */
const STATUS: Record<string, { word: string; tone: string }> = {
  pass: { word: "Passed", tone: "positive" },
  fail: { word: "Needs a change", tone: "attention" },
  unclear: { word: "Unclear", tone: "info" },
  skipped: { word: "Not checked", tone: "neutral" },
  unavailable: { word: "For a person", tone: "info" },
};

const SETTLED = { word: "Confirmed by two reviewers", tone: "positive" };

const DECISION: Record<PanelRun["decision"], string> = {
  verified: "Verified",
  retake: "Retake",
  firm_review: "Firm review",
};

/** After the decision lands, the refund follows: one beat later, as PayPal does. */
const PAID_DELAY_MS = 520;

/**
 * The "Try a photo" fragment: runs of the real verifier, replayed check by check, then the decision and, for a
 * verified photo, the refund. Every reason, score and time shown is the recorded one (content/public/verify-runs.json),
 * and the 26125 photo is answered live by the claim path's free picture match. The live run is on /try.
 */
export function TryPanel({ runs }: { runs: PanelRun[] }) {
  const [pick, setPick] = useState(0);
  const [shown, setShown] = useState(runs[0]?.checks.length ?? 0);
  const [paidOn, setPaidOn] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const run = runs[pick];

  const play = (i: number) => {
    setPick(i);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(runs[i].checks.length);
      setPaidOn(true);
      return;
    }
    setShown(0);
    setPaidOn(false);
  };

  // Step through the checks, one every 280 ms, then the refund one beat after the decision.
  useEffect(() => {
    if (!run) return;
    if (shown < run.checks.length) {
      const t = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 200 : 280);
      return () => window.clearTimeout(t);
    }
    if (run.paid && !paidOn) {
      const t = window.setTimeout(() => setPaidOn(true), PAID_DELAY_MS);
      return () => window.clearTimeout(t);
    }
  }, [shown, run, paidOn]);

  // The first replay starts when the panel comes into view; before that every check is already shown, so nothing is
  // hidden from readers without script or with reduced motion.
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || started.current) return;
        started.current = true;
        setShown(0);
        setPaidOn(false);
        io.disconnect();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!run) return null;
  const done = shown >= run.checks.length;
  const elapsed = done ? run.totalMs : Math.round((run.totalMs * shown) / run.checks.length);

  return (
    <div ref={root} className="tp" data-ui>
      <div className="tp-picks" role="radiogroup" aria-label="Sample photo" style={{ "--tp-n": runs.length + 1 } as React.CSSProperties}>
        {runs.map((r, i) => (
          <button key={r.id} type="button" role="radio" aria-checked={i === pick} className="tp-pick" onClick={() => play(i)}>
            <img src={r.thumb} alt="" width={r.thumbW} height={r.thumbH} loading="lazy" />
            <span>{r.pick}</span>
          </button>
        ))}
        <Link className="tp-pick tp-upload" href="/try">
          <span className="tp-plus" aria-hidden="true" />
          <span>Your photo</span>
        </Link>
      </div>

      <div className="tp-sheet">
        <div className="tp-head">
          <p className="tp-recall">
            {run.recall.label}: {run.recall.title}
          </p>
          <p className="tp-time tabular" aria-label={`Checked in ${fmtMs(run.totalMs)}`}>
            {fmtMs(elapsed)}
          </p>
        </div>
        <p className="tp-about">
          <span className="tp-title">{run.title}.</span> {run.about}
        </p>
        <ol className="tp-checks" aria-label="Checks">
          {run.checks.map((c, i) => {
            // Unsure, then settled by the two reviewers: one state, with the photo check's own score a tap away.
            const settled = run.reviewersSettled && c.status === "unclear";
            const st = settled ? SETTLED : (STATUS[c.status] ?? STATUS.unclear);
            const on = i < shown;
            return (
              <li key={c.id} className="tp-check" data-on={on ? "" : undefined}>
                <span className="tp-name">{c.name}</span>
                <span className="pill" data-tone={on ? st.tone : undefined}>
                  {on ? st.word : "Checking"}
                </span>
                <span className="tp-reason">{on && c.status !== "skipped" ? (settled ? settledLine : c.reason) : " "}</span>
                {on && settled && (
                  <details className="tp-score">
                    <summary>The photo check&rsquo;s own score</summary>
                    <p>{scoreLine(c.score, c.reason)}</p>
                  </details>
                )}
                {on && (
                  <span className="tp-tech lp-tech">
                    {c.id}
                    {c.score !== null ? `, score ${c.score.toFixed(2)}` : ""}: {c.technical}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <div className="tp-result" data-decision={run.decision} data-on={done ? "" : undefined} aria-live="polite">
          {done && (
            <>
              <p className="tp-decision">{DECISION[run.decision]}</p>
              <p className="tp-next">{run.next}</p>
              {run.more && (
                <details className="tp-score">
                  <summary>How long each step took</summary>
                  <p>{run.more}</p>
                </details>
              )}
              {run.settings && <p className="tp-settings lp-tech">Recorded with: {run.settings}</p>}
            </>
          )}
        </div>
        {run.paid && (
          <div className="tp-paid" data-on={done && paidOn ? "" : undefined} aria-live="polite">
            {done && paidOn && (
              <>
                <p className="tp-paid-line">
                  <span className="pill" data-tone="paid">
                    Refund
                  </span>{" "}
                  {run.paid.line}
                </p>
                <p className="tp-paid-note">{run.paid.note}</p>
                {run.paid.more && (
                  <details className="tp-score">
                    <summary>How the refund is sent</summary>
                    <p>{run.paid.more}</p>
                  </details>
                )}
                <p className="tp-paid-cta">
                  <Link className="text-link" href={run.paid.href}>
                    {run.paid.cta}
                  </Link>
                </p>
              </>
            )}
          </div>
        )}
        <p className="tp-credit">{run.credit} A run of Remedy&rsquo;s real verifier, replayed; nothing here calls the AI.</p>
      </div>
    </div>
  );
}
