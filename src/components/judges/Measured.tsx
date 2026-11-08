import Link from "next/link";
import { fmtMs } from "@/lib/api/format";
import { MEASURED, cpscExampleRun } from "./data";
import { freeTimings } from "./errors";

/** What the owner's claim flow measured in the PayPal sandbox, each figure with where it came from. */
export function Measured() {
  const ex = cpscExampleRun();
  const t = freeTimings();
  return (
    <>
      <ul className="jm">
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
          <p className="jm-fig tabular">{t.official.median} ms</p>
          <p className="jm-what">
            median to answer a photo that is a recall&rsquo;s own published picture, with no model call ({t.official.min} to {t.official.max} ms in {t.official.n} recorded runs). The hash comparison itself took {t.match.min} to {t.match.max} ms; the
            rest is decoding the photo and loading the recall&rsquo;s pictures.
          </p>
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
        Measured {new Date(`${MEASURED.measuredAt}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "long" })}. Try each one:{" "}
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
