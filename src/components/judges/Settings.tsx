import { fmtDate } from "@/lib/api/format";
import { answerChanges, errorRates, readingAccuracy, sweepSettings, type AnswerChange } from "./errors";

const NAMES: Record<string, string> = { "opus-medium": "Claude Opus 5.5, medium effort", "opus-low": "Claude Opus 5.5, low effort", "sonnet-default": "Claude Sonnet 5.5", "haiku-medium": "Claude Haiku 5.5, medium effort" };
const SHORT: Record<string, string> = { "opus-medium": "Opus medium", "opus-low": "Opus low", "sonnet-default": "Sonnet", "haiku-medium": "Haiku" };
const NUM: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five" };
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "none");

const DECISION_WORDS: Record<string, string> = { verified: "paid", retake: "a new photo asked for", firm_review: "sent to a person at the firm" };
const CHECK_WORDS: Record<string, string> = { C1: "right product", C2: "made safe", C3: "own photo", C4: "within the recall" };

/** A known answer in plain words: "a new photo asked for; right product pass, made safe fail". */
function answerWords(e: AnswerChange["was"]): string {
  const parts: string[] = [];
  if (e.decision) parts.push(DECISION_WORDS[e.decision] ?? e.decision);
  if (e.not_decision) parts.push(`anything but ${DECISION_WORDS[e.not_decision] ?? e.not_decision}`);
  const checks = Object.entries(e.checks ?? {}).map(([id, st]) => `${CHECK_WORDS[id] ?? id} ${st}`);
  if (checks.length) parts.push(checks.join(", "));
  return parts.join("; ");
}

/**
 * Which model setting the claim path uses, and why, from the measured sweep (content/verify/sweep-results.json),
 * scored by src/components/judges/errors.ts: money first (paid when it should not have been), then accuracy against the
 * known answers as they stood the day the sweep ran, then re-scored against today's, beside the dated list of every
 * answer revised in between (content/verify/answer-changes.json).
 */
export function Settings() {
  const rows = sweepSettings();
  const claim = rows.find((r) => r.claimPath)!;
  const hb = errorRates().heldBack;
  // A cheaper setting worth measuring next: no wrong payment, at least as right on both scores, and no more CPSC pictures paid with the match off.
  const cheaper = rows.filter(
    (r) => !r.claimPath && r.usdPerCase < claim.usdPerCase && r.wrongPay.count === 0 && r.atSweep.count >= claim.atSweep.count && r.correct.count >= claim.correct.count && r.officialPaid.count <= claim.officialPaid.count,
  );
  const changes = answerChanges();
  return (
    <>
      <div className="jb-wrap" role="region" aria-label="Model settings in the sweep" tabIndex={0}>
        <table className="jb">
          <caption className="sr-only">
            The four model settings in the sweep: paid wrongly, known answers right as scored the day the sweep ran, re-scored with today&rsquo;s answers, the CPSC&rsquo;s own pictures paid with the match off, cost and time
          </caption>
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">Paid when it should not have been</th>
              <th scope="col">Right, scored the day of the sweep</th>
              <th scope="col">Re-scored with today&rsquo;s answers</th>
              <th scope="col">Would have paid a CPSC picture, match off</th>
              <th scope="col">Cost per check</th>
              <th scope="col">Median time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-rm={r.claimPath ? "" : undefined}>
                <th scope="row">
                  {NAMES[r.id] ?? r.id}
                  {r.claimPath ? <span className="muted"> (the claim path)</span> : null}
                </th>
                <td className="jb-num tabular">
                  {r.wrongPay.count} of {r.wrongPay.of}
                </td>
                <td className="jb-num tabular">
                  {r.atSweep.count} of {r.atSweep.of} <span className="muted">({pct(r.atSweep.count, r.atSweep.of)})</span>
                </td>
                <td className="jb-num tabular">
                  {r.correct.count} of {r.correct.of}
                </td>
                <td className="jb-num tabular">
                  {r.officialPaid.count} of {r.officialPaid.of}
                </td>
                <td className="jb-num tabular">${r.usdPerCase.toFixed(4)}</td>
                <td className="jb-num tabular">{r.medianSeconds} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-prose">
        On the measure that matters for money, the settings tie: none paid a photo it should not have ({claim.wrongPay.count} of {claim.wrongPay.of} for each). Scored the day the sweep ran, the claim path&rsquo;s setting was right on{" "}
        <span className="tabular">
          {claim.atSweep.count} of {claim.atSweep.of}
        </span>
        ; re-scored after the {NUM[changes.length] ?? changes.length} {changes.length === 1 ? "revision" : "revisions"} listed below, on{" "}
        <span className="tabular">
          {claim.correct.count} of {claim.correct.of}
        </span>
        . Held back can only be measured on an owner&rsquo;s own photo that should be paid, and only the claim path&rsquo;s setting has run on one: Brightline&rsquo;s sample charger, paid in {hb.of - hb.count} of {hb.of} decisions
        {hb.count ? `, the other ${hb.count === 1 ? "one" : hb.count} sent to a person at the firm` : ""}. So the claim path stays on {NAMES[claim.id]}.
        {cheaper.length
          ? ` ${cheaper.map((c) => NAMES[c.id]).join(" and ")} ${cheaper.length === 1 ? "scores" : "score"} at least as well on both counts, with no more CPSC pictures paid with the match off, at ${cheaper.map((c) => `$${c.usdPerCase.toFixed(4)}`).join(" and ")} a check, and ${cheaper.length === 1 ? "is" : "are"} the next to measure on owners' photos.`
          : ""}
      </p>
      <h3 id="answer-changes" className="ev-sub">
        Known answers revised after the sweep
      </h3>
      <ol className="ev-changes">
        {changes.map((a) => (
          <li key={a.case}>
            <p>
              <strong>{fmtDate(a.date)}</strong>, case <code>{a.case}</code> ({a.photo}): was <em>{answerWords(a.was)}</em>, now <em>{answerWords(a.now)}</em>.
            </p>
            <p>{a.why}</p>
            <p className="muted tabular">
              Trials whose score moved:{" "}
              {rows
                .map((r) => {
                  const c = r.changed.find((x) => x.case === a.case);
                  return c ? `${SHORT[r.id] ?? r.id} ${c.trials} of ${c.of}` : null;
                })
                .filter(Boolean)
                .join(", ")}
              .
            </p>
          </li>
        ))}
      </ol>
      <p className="page-note">
        Each revision, with the answer before and after, is in content/verify/answer-changes.json. tests/facts.test.ts fails when the day-of-sweep score differs from the pass marks the sweep wrote when it ran, or when a case drifts from its listed answer.
      </p>
    </>
  );
}

const CASE_WORDS: Record<string, string> = {
  "made-safe-hair-dryer-cord-cut": "Hair dryer, cord cut (recall 26125)",
  "made-safe-helmet-straps-cut": "Helmet, straps cut (recall 25007)",
  "made-safe-helmet-in-trash": "Helmet in the trash (recall 25007)",
};

/** Reading accuracy on the CPSC's own photos, and which check asked for a new photo, and why. */
export function Reading() {
  const ra = readingAccuracy();
  return (
    <>
      <p className="page-prose">
        With the official-picture match off, the claim path&rsquo;s setting read the CPSC&rsquo;s own photos of {ra.photos} recalled products made safe, {ra.trials / ra.photos} trials each: right product <strong className="tabular">{ra.product} of {ra.trials}</strong>, made safe{" "}
        <strong className="tabular">
          {ra.madeSafe} of {ra.trials}
        </strong>
        , <span className="tabular">{ra.right} of {ra.readings}</span> readings in all.
      </p>
      <ul className="page-prose ev-reading">
        {ra.asked.map((a) => (
          <li key={a.caseId}>
            <strong>{CASE_WORDS[a.caseId] ?? a.caseId}</strong>:{" "}
            {a.retakes === 0
              ? `verified in each of ${a.trials} trials, both readings right.`
              : `asked for a new photo in ${a.retakes} of ${a.trials}, each time by the made-safe check (C2). ${
                  a.madeSafeKnown === "fail"
                    ? "That is the right reading: the recall asks for two photos, the straps cut and the helmet in the trash, and this one does not show the straps."
                    : `The model did not confirm the cut, and its own-photo check came back unsure in ${a.ownPhotoUnsure === a.retakes ? "each" : `${a.ownPhotoUnsure} of ${a.retakes}`}: it recognized the CPSC's published picture. On a claim, the hash match answers this picture first.`
                }`}
          </li>
        ))}
      </ul>
    </>
  );
}
