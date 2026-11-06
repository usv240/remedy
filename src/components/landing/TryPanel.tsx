"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtMs } from "@/lib/api/format";

export type PanelCheck = { id: string; name: string; status: string; score: number | null; reason: string; technical: string };
export type PanelRun = {
  id: string;
  title: string;
  about: string;
  thumb: string;
  thumbW: number;
  thumbH: number;
  credit: string;
  recall: { number: string; title: string };
  decision: "verified" | "retake" | "firm_review";
  next: string;
  totalMs: number;
  settings: string | null;
  checks: PanelCheck[];
};

const STATUS: Record<string, { word: string; tone: string }> = {
  pass: { word: "Passed", tone: "positive" },
  fail: { word: "Not yet", tone: "attention" },
  unclear: { word: "Unclear", tone: "info" },
  skipped: { word: "Not needed", tone: "neutral" },
  unavailable: { word: "For a person", tone: "info" },
};

const DECISION: Record<PanelRun["decision"], string> = {
  verified: "Verified",
  retake: "Retake",
  firm_review: "A closer look",
};

/**
 * The "Try a photo" fragment: three recorded runs of the real verifier, replayed check by check. Every reason, score
 * and time shown is the recorded one (content/public/verify-runs.json). The live run, with a sandbox payout, is on /try.
 */
export function TryPanel({ runs }: { runs: PanelRun[] }) {
  const [pick, setPick] = useState(0);
  const [shown, setShown] = useState(runs[0]?.checks.length ?? 0);
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const run = runs[pick];

  const play = (i: number) => {
    setPick(i);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(runs[i].checks.length);
      return;
    }
    setShown(0);
  };

  // Step through the checks, one every 280 ms.
  useEffect(() => {
    if (!run || shown >= run.checks.length) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 200 : 280);
    return () => window.clearTimeout(t);
  }, [shown, run]);

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
      <div className="tp-picks" role="radiogroup" aria-label="Sample photo">
        {runs.map((r, i) => (
          <button key={r.id} type="button" role="radio" aria-checked={i === pick} className="tp-pick" onClick={() => play(i)}>
            <img src={r.thumb} alt="" width={r.thumbW} height={r.thumbH} loading="lazy" />
            <span>{r.title}</span>
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
            Recall {run.recall.number}: {run.recall.title}
          </p>
          <p className="tp-time tabular" aria-label={`Checked in ${fmtMs(run.totalMs)}`}>
            {fmtMs(elapsed)}
          </p>
        </div>
        <p className="tp-about">{run.about}</p>
        <ol className="tp-checks" aria-label="Checks">
          {run.checks.map((c, i) => {
            const st = STATUS[c.status] ?? STATUS.unclear;
            const on = i < shown;
            return (
              <li key={c.id} className="tp-check" data-on={on ? "" : undefined}>
                <span className="tp-name">{c.name}</span>
                <span className="pill" data-tone={on ? st.tone : undefined}>
                  {on ? st.word : "Checking"}
                </span>
                <span className="tp-reason">{on ? c.reason : " "}</span>
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
              {run.settings && <p className="tp-settings lp-tech">Recorded with: {run.settings}</p>}
            </>
          )}
        </div>
        <p className="tp-credit">{run.credit} Recorded run of Remedy&rsquo;s verifier; nothing here calls the AI.</p>
      </div>
    </div>
  );
}
