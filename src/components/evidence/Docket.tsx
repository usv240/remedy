import { fmtInt } from "@/lib/api/format";
import run from "../../../content/public/docket-replay.json";

/**
 * The docket replay (content/public/docket-replay.json, recorded by scripts/public/docket-replay.ts with no model call):
 * the pattern on the CPSC's 2026 docket on recall claims, one device filing over 400 claims with photos from the same
 * vantage point, replayed in code with one claimed sample photo and 400 copies of it at two sample firms. A replay of
 * the pattern, not of the real claims. Every figure is read from the file; tests/docket-replay.test.ts derives them.
 */
export function docketReplay() {
  const t = run.totals;
  const fern = t.byFirm["Fernway Home" as keyof typeof t.byFirm];
  return { ...t, fernway: fern, pattern: run.pattern, seed: run.seed };
}

/** One sentence for the home page's ideas and /evidence: the replay, said as a replay. */
export function docketWords() {
  const d = docketReplay();
  return `Replayed in code, the pattern on the CPSC's 2026 docket, one device filing over ${d.pattern.claims} claims: ${fmtInt(d.claims)} altered copies of one claimed photo, filed at two sample firms, and the pool held ${fmtInt(d.held)} before any model call. Code asked for a new photo on ${fmtInt(d.newPhotoAsked)} more, and the ${fmtInt(d.reachedModel)} that went on to the model step are all phone screenshots, which the own-photo check reads for a screen. None was paid.`;
}

export function DocketReplay() {
  const d = docketReplay();
  return (
    <div className="ev-replay">
      <h3 className="ev-sub">The docket&rsquo;s pattern, replayed</h3>
      <p className="page-prose tabular">
        A comment on the CPSC&rsquo;s 2026 docket on recall claims (
        <a className="text-link" href={d.pattern.url} target="_blank" rel="noreferrer">
          {d.pattern.docket}
        </a>
        ) describes one device filing over {d.pattern.claims} claims with photos taken from the same vantage point. This replays that pattern in code, not the real claims: one photo already claimed at Brightline Home, {fmtInt(d.claims)} copies of it made with the
        changes measured below (one to three each, saved again, resized, cropped, turned, brightened, screenshotted or mirrored), filed by turns at Brightline Home and Fernway Home through the claim path&rsquo;s hash step, with no model call.
      </p>
      <p className="page-prose tabular">
        <strong>
          The pool held {fmtInt(d.held)} of {fmtInt(d.claims)} before any model call.
        </strong>{" "}
        Fernway Home, which had never seen the photo, held {fmtInt(d.fernway.held)} of its {fmtInt(d.fernway.claims)}: its first by Brightline&rsquo;s hash, and each held copy then joined the pool, as the claim route keeps every claim not asked for a new photo. Code
        asked for a new photo on {fmtInt(d.newPhotoAsked)} more ({fmtInt(d.newPhotoQuality)} shrunk too far for the photo-quality check). The {fmtInt(d.reachedModel)} that went on to the model step are all phone screenshots, which the own-photo check reads for a
        screen; their answers are not replayed, and they are left out of the pool, which can only lower the count. None was paid. A claim took a median of {fmtInt(d.medianMs)} ms.
      </p>
      <p className="page-note">Recorded by scripts/public/docket-replay.ts (seed {d.seed}) to content/public/docket-replay.json; tests/docket-replay.test.ts makes and files the first claims again.</p>
    </div>
  );
}
