import { Info } from "@/components/Info";
import { fmtDate } from "@/lib/api/format";
import Link from "next/link";
import { errorRates, hashSpeed, readingAccuracy, type ErrorRate } from "./errors";

const photos = (n: number) => (n === 1 ? "1 photo" : `${n} photos`);
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** What happened on each photo behind a count that is not zero, in plain words, from the decisions themselves. */
function happened(r: ErrorRate): string {
  if (!r.count) return "";
  const parts = r.misses.map((m) => {
    const went = [m.firmReview ? `went to a person at the firm ${times(m.firmReview)}` : "", m.retake ? `asked for a new photo ${times(m.retake)}` : "", m.verified ? `was paid ${times(m.verified)}` : ""]
      .filter(Boolean)
      .join(" and ");
    const own = m.notOwn ? `; the model noted it was not the owner's own camera photo in ${m.notOwn === m.n ? "each" : `${m.notOwn} of ${m.n}`}` : "";
    return `${m.title.charAt(0).toUpperCase()}${m.title.slice(1)}: it ${went}${own}`;
  });
  const lead = r.misses.length === 1 && r.count > 1 ? `All ${r.count} are one photo. ` : "";
  return `${lead}${parts.join(". ")}.`;
}

/**
 * The two error rates that matter for money, right under the results: paid when it should not have been, and held
 * back when it could have been paid. Each with its denominator, a one-line definition and, in Technical view, the
 * files it is counted from (src/components/evidence/errors.ts).
 */
export function ErrorRates() {
  const e = errorRates();
  const hs = hashSpeed();
  const ra = readingAccuracy();
  const src = e.sources;
  const n = (s: string) => e.bySource.find((b) => b.source === s)?.decisions ?? 0;
  return (
    <section id="errors" className="je" aria-labelledby="errors-h">
      <div className="je-lead">
        <h2 id="errors-h" className="je-title">
          Error rates, on photos with a known answer <Info id="evidence.errors" label="" topic="The error rates" />
        </h2>
        <p className="je-scope tabular">
          Every recorded decision where the right answer is known: {e.decisions} decisions on {e.photos} photos.
        </p>
      </div>
      <div className="je-item">
        <p className="je-fig tabular">
          {e.wrongPay.count} <span className="je-of">of {e.wrongPay.of}</span>
        </p>
        <p className="je-what">paid when it should not have been</p>
        <p className="je-def">
          A decision to pay a photo whose known answer is no payment: a copy, a look-alike, another product, or one not yet made safe, like a charger opened up with its cord still attached. <span className="tabular">{photos(e.wrongPay.cases)}</span>.
        </p>
        {e.wrongPay.count > 0 && <p className="je-def">{happened(e.wrongPay)}</p>}
      </div>
      <div className="je-item">
        <p className="je-fig tabular">
          {e.heldBack.count} <span className="je-of">of {e.heldBack.of}</span>
        </p>
        <p className="je-what">held for a person or a new photo when it could have been paid</p>
        <p className="je-def">
          A photo whose known answer is to pay, sent to a person at the firm or asked for a new photo instead: the sample charger with its cord cut, an owner&rsquo;s own photo of a product made safe. <span className="tabular">{photos(e.heldBack.cases)}</span>.
        </p>
        {e.heldBack.count > 0 && <p className="je-def je-happened">{happened(e.heldBack)}</p>}
      </div>
      <div className="je-item">
        <p className="je-fig tabular">
          {ra.right} <span className="je-of">of {ra.readings}</span>
        </p>
        <p className="je-what">readings right on real CPSC recalls</p>
        <p className="je-def">
          The CPSC&rsquo;s own photos of {ra.photos} recalled products made safe, from {ra.recalls} recalls, {ra.trials / ra.photos} trials each at the claim path&rsquo;s setting: right product <span className="tabular">{ra.product} of {ra.trials}</span>, made safe{" "}
          <span className="tabular">
            {ra.madeSafe} of {ra.trials}
          </span>
          .{" "}
          <Link className="text-link" href="/evidence/photo-checks#reading">
            What it read
          </Link>
        </p>
      </div>
      {e.officialPicture.of > 0 && (
        <p className="je-def je-code-first">
          Why a code check runs before the model: with the official-picture match switched off, the model alone would have paid for the recall&rsquo;s own published picture in{" "}
          <span className="tabular">
            {e.officialPicture.paid} of {e.officialPicture.of}
          </span>{" "}
          runs. On every claim the match runs first and answers that picture in <span className="tabular">{hs.short}</span>, with no payment, so these runs count in neither rate.
        </p>
      )}
      <p className="je-src lp-tech tabular">
        Counted by src/components/evidence/errors.ts from {src.sweep} ({n("sweep")} decisions: {e.sweep.cases} photos, {e.sweep.trials} trials each, at the claim path&rsquo;s setting, Claude Opus 5.5 at medium effort,
        run {fmtDate(e.sweep.ranAt.slice(0, 10))}),{" "}
        {e.sample && (
          <>
            {src.sample} ({n("sample")}: Brightline&rsquo;s sample charger, {e.sample.photos} photos, {e.sample.trials} trials each at the same setting, run {fmtDate(e.sample.ranAt.slice(0, 10))}),{" "}
          </>
        )}
        {src.presets} ({n("preset")}) and {src.runs} ({n("public")}; a run that repeats a preset&rsquo;s model answer is counted once). Known answers: {src.cases} and{" "}
        {src.presetIndex}. Across all {e.sweep.configs} model settings in the sweep, paid when it should not have been: {e.sweep.allConfigsWrongPay.count} of {e.sweep.allConfigsWrongPay.of}.
      </p>
    </section>
  );
}
