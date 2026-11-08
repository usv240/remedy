"use client";

import type { CheckView } from "@/app/api/claims/_lib/types";
import { ClaimInfo } from "./ClaimInfo";
import { CHECK_ORDER, checkWord, scoreLine, seconds, settledLine } from "./format";

export type Stage = "sending" | "stored" | "vision" | "reviewers" | "done";

const STAGE_LINE: Record<Stage, string> = {
  sending: "Sending your photo",
  stored: "Checking the photo",
  vision: "Comparing it with the official recall pictures",
  reviewers: "Two reviewers are taking a closer look",
  done: "Checked",
};

function Mark({ status }: { status: CheckView["status"] | "pending" }) {
  if (status === "pending") return <span className="cl-mark" data-s="pending" aria-hidden="true" />;
  return (
    <svg className="cl-mark" data-s={status} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" />
      {status === "pass" && <path d="M6 10.5l2.6 2.6L14 7.6" />}
      {status === "fail" && <path d="M10 5.5v5.5M10 14.2v.3" />}
      {(status === "unclear" || status === "unavailable") && <path d="M6.5 10h7" />}
      {status === "skipped" && <path d="M7 10h6" />}
    </svg>
  );
}

/**
 * The six checks, completing in turn. While the server works, each shows as waiting and the line above names the real
 * stage (sending, comparing with the official pictures, the two reviewers). When the answer lands, the checks resolve
 * in order, 70 ms apart, and the timer stops at the real elapsed time.
 */
export function Checking({ checks, stage, elapsedMs, technical, reviewersAgreed = false }: { checks: CheckView[] | null; stage: Stage; elapsedMs: number; technical?: Record<string, number> | null; reviewersAgreed?: boolean }) {
  const done = Boolean(checks);
  return (
    <div className="cl-checking" data-ui>
      <div className="cl-checking-head">
        <p className="cl-stage" role="status" aria-live="polite">
          {STAGE_LINE[stage]}
          {!done && <span className="cl-dots" aria-hidden="true" />}
        </p>
        <p className="cl-elapsed tabular" aria-label={`${done ? "Checked in" : "Elapsed"} ${seconds(elapsedMs)}`}>
          {seconds(elapsedMs)}
        </p>
        <ClaimInfo k="claim.checks" topic="the six checks" />
      </div>
      {done && technical && technical.reviewers_ms > 0 && technical.vision_ms > 0 ? (
        <p className="cl-split tabular">
          {seconds(technical.vision_ms)} for the photo check, then {seconds(technical.reviewers_ms)} for the two reviewers.
        </p>
      ) : null}
      <ol className="cl-checks">
        {CHECK_ORDER.map(({ id, name }, i) => {
          const c = checks?.find((x) => x.id === id);
          const w = c ? checkWord(c.status, { reviewersAgreed }) : null;
          // Unsure, then settled by the two reviewers: shown as confirmed, with the photo check's own reading a tap away.
          const settled = Boolean(c && c.status === "unclear" && reviewersAgreed);
          const shown = settled ? "pass" : (c?.status ?? "pending");
          return (
            <li key={id} className="cl-check" data-s={shown} style={{ "--i": i } as React.CSSProperties}>
              <Mark status={shown} />
              <div className="cl-check-body">
                <p className="cl-check-name">
                  <span>{name}</span>
                  <span className="cl-check-word" data-tone={w?.tone}>
                    {w ? w.word : "Waiting"}
                  </span>
                </p>
                {c && c.status !== "skipped" && <p className="cl-check-why">{settled ? settledLine : c.reason_plain}</p>}
                {c && settled && (
                  <details className="cl-score">
                    <summary>The photo check&rsquo;s own score</summary>
                    <p>{scoreLine(c.score, c.reason_plain)}</p>
                  </details>
                )}
                {c && (
                  <p className="cl-tech cl-check-tech">
                    {c.id}
                    {c.score !== null ? `, score ${c.score}` : ""}: {c.reason_technical}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {technical && (
        <p className="cl-tech cl-timings tabular">
          Decode {technical.decode_ms} ms, official images {technical.official_ms} ms{technical.match_ms !== undefined ? `, hash match ${technical.match_ms} ms` : ""}, vision {technical.vision_ms} ms, checks {technical.checks_ms} ms, reviewers {technical.reviewers_ms} ms, total {technical.total_ms} ms on the server.
        </p>
      )}
    </div>
  );
}
