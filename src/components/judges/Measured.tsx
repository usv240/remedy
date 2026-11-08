import Link from "next/link";
import { fmtMs } from "@/lib/api/format";
import { MEASURED, cpscExampleRun } from "./data";
import { checkTimes, hashSpeed } from "./errors";

/** What the owner's claim flow measured in the PayPal sandbox, each figure with where it came from. */
export function Measured() {
  const ex = cpscExampleRun();
  const ct = checkTimes();
  const hs = hashSpeed();
  return (
    <>
      <ul className="jm">
        <li>
          <p className="jm-fig tabular">about {ct.about} s</p>
          <p className="jm-what">
            for one photo check by Claude Opus 5.5 at the claim path&rsquo;s setting: a median of {ct.check.median} s, {ct.check.min} to {ct.check.max} s across {ct.check.n} recorded live checks. When the product match is unclear, the two reviewers add a
            median of {ct.reviewers.median} s ({ct.reviewers.min} to {ct.reviewers.max} s in {ct.reviewers.n} runs).
          </p>
          <p className="jm-src">Counted from {ct.sources.join(", ")}</p>
        </li>
        {MEASURED.items.map((m) => (
          <li key={m.id}>
            <p className="jm-fig tabular">{m.figure}</p>
            <p className="jm-what">{m.what}.</p>
            <p className="jm-src">
              {MEASURED.environment}, {m.source}
            </p>
          </li>
        ))}
        <li>
          <p className="jm-fig tabular">{hs.answer.median} ms</p>
          <p className="jm-what">median for the free picture match to answer, with no model call. {hs.sentence}</p>
          <p className="jm-src">On the machine that recorded the runs, content/public/verify-runs.json</p>
        </li>
        {ex && (
          <li>
            <p className="jm-fig tabular">{ex.score.toFixed(2)}</p>
            <p className="jm-what">
              right-product score for the CPSC&rsquo;s own 26125 photo, cut cord {ex.cut ? "confirmed" : "not confirmed"}, with the official-picture match off.
              {ex.noticed ? " Claude also saw it is the CPSC's picture; with the match on, that is answered in code before any model call." : ""}
            </p>
            <p className="jm-src">
              {MEASURED.environment}, one live call in {fmtMs(ex.ms)}, content/presets/recorded/cpsc-example.technical.json
            </p>
          </li>
        )}
      </ul>
      <p className="page-note">
        Sandbox payments measured {new Date(`${MEASURED.measuredAt}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "long" })}. Try each one:{" "}
        <Link className="text-link" href="/try">
          the presets
        </Link>
        ,{" "}
        <Link className="text-link" href="/try/shop">
          the sample shop
        </Link>{" "}
        (buy, claim, and get refunded to the original capture).
      </p>
    </>
  );
}
