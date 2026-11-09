"use client";

import type { ClaimView, PayView } from "@/app/api/claims/_lib/types";
import type { MadeSafeExample } from "@/app/api/claims/_lib/recall-text";
import { ClaimInfo } from "./ClaimInfo";
import { Example } from "./Example";
import { money, reviewWindow } from "./format";
import { Payout } from "./Payout";
import { Reviewers } from "./Reviewers";
import { StepArt } from "./StepArt";
import type { StepKind } from "./steps";

export type ResultContext = {
  /** The drawing for what the recall asks (cut cord, write the word), shown with a retake. */
  action: StepKind | null;
  word: string | null;
  example: MadeSafeExample | null;
};

/**
 * The answer, result first: verified (choose where the refund goes and send it), retake (what to change, with the
 * drawing and the CPSC example), or firm review (who looks and when, and where to send the refund once approved).
 * `preview` is a ready-made example on /try: it shows the answer and never pays.
 */
/** `previewNote` replaces the ready-made example's note, where the example offers its own way to pay (the sandbox payout on /try). */
export function Result({ claim, ctx, onRetake, onPaid, preview = false, previewNote }: { claim: ClaimView; ctx: ResultContext; onRetake?: () => void; onPaid?: (p: PayView) => void; preview?: boolean; previewNote?: React.ReactNode }) {
  const d = claim.decision;
  if (d === "verified") {
    return (
      <div className="cl-result" data-d="verified" data-ui>
        <p className="cl-result-k">
          <span className="pill" data-tone="positive">
            Verified
          </span>
          <ClaimInfo k="claim.verified" topic="verified" />
        </p>
        <h3 className="cl-result-title">Your photo checks out.</h3>
        {claim.amount && (
          <p className="cl-amount">
            <span className="tabular">{money(claim.amount.value)}</span> refund
            {claim.amount.source === "demo" && <span className="cl-tech"> (the sample firm&rsquo;s demonstration amount for this recall)</span>}
          </p>
        )}
        {preview || !onPaid ? (
          <p className="cl-note">{previewNote ?? "This is a ready-made example, so nothing is paid. Run your own photo to send a sandbox refund."}</p>
        ) : (
          <Payout claim={claim} onDone={onPaid} />
        )}
      </div>
    );
  }

  if (d === "retake") {
    const g = claim.guidance;
    // Not their own photo, or a person in it: the drawing of the made-safe step would not help here.
    const own = claim.decided_by === "own_photo" || claim.decided_by === "person";
    const quality = claim.decided_by === "quality" || claim.decided_by === "unreadable";
    return (
      <div className="cl-result" data-d="retake" data-ui>
        <p className="cl-result-k">
          <span className="pill" data-tone="attention">
            Retake
          </span>
          <ClaimInfo k="claim.retake" topic="retake" />
        </p>
        <h3 className="cl-result-title">{g?.plain ?? "Please take the photo again."}</h3>
        {g && g.steps.length > 0 && (
          <ul className="cl-guide">
            {g.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
        {!quality && !own && ctx.action && (
          <div className="cl-retake-art">
            <StepArt kind={ctx.action} word={ctx.word ?? undefined} />
            <p>{ctx.action === "write" ? `Big letters, on the product itself: ${ctx.word}.` : ctx.action === "cut_cord" ? "Cut all the way through, with both cut ends in the photo." : "Show the whole product, with the change in view."}</p>
          </div>
        )}
        {ctx.example && !quality && <Example example={ctx.example} />}
        {g?.technical && <p className="cl-tech cl-result-tech">{g.technical}</p>}
        {onRetake && (
          <div className="cl-actions">
            <button type="button" className="btn btn-ink" onClick={onRetake}>
              Take a new photo
            </button>
          </div>
        )}
      </div>
    );
  }

  // Firm review: each open reason once, with the checks it covers.
  const open = [...claim.checks.filter((c) => !c.pass && c.status !== "skipped").reduce((m, c) => m.set(c.reason_plain, [...(m.get(c.reason_plain) ?? []), c.name]), new Map<string, string[]>())].map(([why, names]) => ({ why, names }));
  const wait = reviewWindow(claim.firm.review_hours);
  return (
    <div className="cl-result" data-d="review" data-ui>
      <p className="cl-result-k">
        <span className="pill" data-tone="info">
          Firm review
        </span>
        <ClaimInfo k="claim.review" topic="firm review" />
      </p>
      <h3 className="cl-result-title">A person at {claim.firm.name} will take a look.</h3>
      <p className="cl-lead">
        {wait.charAt(0).toUpperCase() + wait.slice(1)}. {preview ? "" : "Your refund is sent as soon as it is approved."}
      </p>
      {open.length > 0 && (
        <ul className="cl-guide">
          {open.map((o) => (
            <li key={o.why}>
              <strong>{o.names.join(", ")}.</strong> {o.why}
            </li>
          ))}
        </ul>
      )}
      {claim.summary && <p className="cl-tech cl-result-tech">{claim.summary.technical}</p>}
      {claim.review && (
        <div className="cl-tech">
          <Reviewers review={claim.review} />
        </div>
      )}
      {!preview && onPaid && <Payout claim={claim} review onDone={onPaid} />}
    </div>
  );
}
