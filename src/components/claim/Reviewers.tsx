import type { ReviewView } from "@/app/api/claims/_lib/types";

const ANSWER: Record<string, string> = { meets: "Meets the recall", does_not_meet: "Does not meet it yet", unclear: "Could not tell" };

/** The Two reviewers and the referee, with the evidence each one cited. Shown in Technical view. */
export function Reviewers({ review }: { review: ReviewView }) {
  return (
    <section className="cl-reviewers" data-ui aria-label="Two reviewers">
      <p className="cl-reviewers-k">Two reviewers{review.ms ? <span className="muted tabular">{`, in ${(review.ms / 1000).toFixed(1)} s`}</span> : null}</p>
      <ul className="cl-reviewer-list">
        {review.reviews.map((r) => (
          <li key={r.reviewer} className="cl-reviewer">
            <p className="cl-reviewer-name">
              {r.name} <span className="pill" data-tone={r.answer === "meets" ? "positive" : r.answer === "unclear" ? "info" : "attention"}>{ANSWER[r.answer] ?? r.answer}</span>
            </p>
            <p className="muted cl-reviewer-reads">Reads only {r.reads}. Confidence {r.confidence}.</p>
            <p>{r.reason.plain}</p>
            {r.evidence.length > 0 && (
              <ul className="cl-evidence">
                {r.evidence.map((e, i) => (
                  <li key={i}>
                    {e.seen} <span className="muted">({e.where})</span>
                  </li>
                ))}
              </ul>
            )}
            {!r.counted && r.set_aside_reason && <p className="cl-set-aside">Set aside: {r.set_aside_reason}</p>}
          </li>
        ))}
      </ul>
      <p className="cl-referee">
        <strong>Referee (code):</strong> {review.referee.summary.plain}
      </p>
    </section>
  );
}
