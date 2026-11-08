import { errorRates, readingAccuracy, sweepSettings } from "./errors";

const NAMES: Record<string, string> = { "opus-medium": "Claude Opus 5.5, medium effort", "opus-low": "Claude Opus 5.5, low effort", "sonnet-default": "Claude Sonnet 5.5", "haiku-medium": "Claude Haiku 5.5, medium effort" };
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "none");

/**
 * Which model setting the claim path uses, and why, from the measured sweep (content/verify/sweep-results.json),
 * scored by src/components/judges/errors.ts: money first (paid when it should not have been), then every known answer.
 */
export function Settings() {
  const rows = sweepSettings();
  const claim = rows.find((r) => r.claimPath)!;
  const hb = errorRates().heldBack;
  const cheaper = rows.filter((r) => !r.claimPath && r.wrongPay.count === 0 && r.correct.count >= claim.correct.count);
  return (
    <>
      <div className="jb-wrap" role="region" aria-label="Model settings in the sweep" tabIndex={0}>
        <table className="jb">
          <caption className="sr-only">The four model settings in the sweep: paid wrongly, the CPSC&rsquo;s own pictures paid with the match off, known answers right, cost and time</caption>
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">Paid when it should not have been</th>
              <th scope="col">Would have paid a CPSC picture, match off</th>
              <th scope="col">Known answers right today</th>
              <th scope="col">Scored on the day of the sweep</th>
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
                  {r.officialPaid.count} of {r.officialPaid.of}
                </td>
                <td className="jb-num tabular">
                  {r.correct.count} of {r.correct.of}
                </td>
                <td className="jb-num tabular">{pct(r.atSweep.count, r.atSweep.of)}</td>
                <td className="jb-num tabular">${r.usdPerCase.toFixed(4)}</td>
                <td className="jb-num tabular">{r.medianSeconds} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-prose">
        On the measure that matters for money, the settings tie: none paid a photo it should not have ({claim.wrongPay.count} of {claim.wrongPay.of} for each). Held back can only be measured on an owner&rsquo;s own photo that should be paid, and only the claim path&rsquo;s setting has run
        on one: Brightline&rsquo;s sample charger, paid in {hb.of - hb.count} of {hb.of} decisions. So the claim path stays on {NAMES[claim.id]}.
        {cheaper.length ? ` ${cheaper.map((c) => NAMES[c.id]).join(" and ")} ${cheaper.length === 1 ? "matches" : "match"} it on every known answer here at ${cheaper.map((c) => `$${c.usdPerCase.toFixed(4)}`).join(" and ")} a check, and ${cheaper.length === 1 ? "is" : "are"} the next to measure on owners' photos.` : ""}
      </p>
      <p className="page-note">
        The sweep report first printed {pct(claim.atSweep.count, claim.atSweep.of)} for the claim path&rsquo;s setting. Two answers were revised after it: the helmet in the trash is the second of the two photos recall 25007 asks for, so on its own it is rightly a new-photo
        request; and a look-alike asked for a new photo instead of going to a person, which pays nothing either way. The one trial between the settings now is the CPSC&rsquo;s own hair dryer picture, which on a claim the hash match answers before any model call.
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
