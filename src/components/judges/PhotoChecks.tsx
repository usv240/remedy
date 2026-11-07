import { fmtMs } from "@/lib/api/format";
import { RUNS, cpscExampleReplay, type CpscReplay, type RunRow } from "./data";

/** The same decision words as the claim page, the firm queue and the home page. */
const DECISION: Record<string, string> = { verified: "Verified", retake: "Retake", firm_review: "Firm review" };
/** Which checks settled it, in plain words, read from the recorded checks themselves. */
function decidedBy(r: RunRow): string {
  const c = r.result.checks;
  const parts: string[] = [];
  if (r.result.decided_by === "own_photo") parts.push("Your own photo: it matches the recall's official picture");
  if (r.result.decided_by === "quality") parts.push("Photo quality");
  if (r.result.decided_by !== "own_photo" && c.C3?.status === "fail") parts.push("it matches a photo sent with an earlier claim");
  if (c.C1?.status === "fail") parts.push(`Right product, scored ${c.C1.score?.toFixed(2) ?? "low"}`);
  if (c.C1?.status === "unclear") parts.push(`Right product unclear, scored ${c.C1.score?.toFixed(2) ?? ""}`);
  if (c.C3?.status === "unclear") parts.push(`Your own photo unclear: Claude saw the CPSC's published picture`);
  if (c.C1?.status === "pass" && c.C3?.status === "unclear") parts.push(`right product ${c.C1.score?.toFixed(2) ?? ""}`);
  if (c.C2?.status === "pass" && c.C3?.status === "unclear") parts.push("made safe confirmed");
  if (r.result.decided_by === "made_safe" || c.C2?.status === "fail") parts.push("made safe not confirmed");
  if (r.result.decided_by === "person") parts.push("A person in the photo: asked for one of the product alone, and the photo deleted");
  if (r.result.decided_by === "reviewers") parts.push("Two reviewers");
  const s = parts.join("; ") || r.result.decided_by;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The 26125 row, told the way the rest of the site tells it: the owner flow's recorded answer, read with the official pictures. */
function withReplay(r: RunRow, x: CpscReplay | null): RunRow {
  if (r.id !== "cord-cut-example" || !x) return r;
  return {
    ...r,
    settings: x.settings,
    result: {
      ...r.result,
      decision: x.decision,
      decided_by: x.decidedBy,
      summary: { plain: x.summaryPlain, technical: x.summaryTechnical },
      timings: { total_ms: x.visionMs, vision_ms: x.visionMs },
      checks: Object.fromEntries(x.checks.map((c) => [c.id, { name: c.name, status: c.status, score: c.score, reason: c.reason, technical: c.technical }])),
    },
  };
}

/** Every recorded run of the verifier on the fixture photos: what it was, what it decided, which check decided it. */
export async function PhotoChecks() {
  const replay = await cpscExampleReplay();
  const runs = RUNS.runs.map((r) => withReplay(r, replay));
  return (
    <>
      <div className="jb-wrap" data-ui role="region" aria-label="Photo checks, recorded" tabIndex={0}>
        <table className="jb jf">
          <caption className="sr-only">Each fixture photo, what Remedy decided, and how long it took</caption>
          <thead>
            <tr>
              <th scope="col">The photo</th>
              <th scope="col">Recall</th>
              <th scope="col">Decision</th>
              <th scope="col">Decided by</th>
              <th scope="col" className="jb-num">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <span className="jf-title">{r.title}</span>
                  <span className="jf-about">{r.about}</span>
                </th>
                <td className="tabular">{r.recall}</td>
                <td>
                  <span className="pill" data-tone={r.result.decision === "verified" ? "positive" : r.result.decision === "retake" ? "attention" : "info"}>
                    {DECISION[r.result.decision] ?? r.result.decision}
                  </span>
                </td>
                <td>
                  {decidedBy(r)}
                  <span className="jf-ai">{r.needs_vision ? " Vision, Claude Opus 5.5" : " No AI call"}</span>
                  <span className="jf-tech lp-tech">{r.result.summary.technical}</span>
                </td>
                <td className="jb-num tabular">{fmtMs(r.result.timings.total_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The same cases as a list on a phone, where five columns would only scroll sideways. One of the two shows. */}
      <ul className="jf-list" data-ui aria-label="Photo checks, recorded">
        {runs.map((r) => (
          <li key={r.id} className="jf-item">
            <p className="jf-item-head">
              <span className="jf-title">{r.title}</span>
              <span className="jf-time tabular">{fmtMs(r.result.timings.total_ms)}</span>
            </p>
            <p className="jf-item-meta">
              <span className="pill" data-tone={r.result.decision === "verified" ? "positive" : r.result.decision === "retake" ? "attention" : "info"}>
                {DECISION[r.result.decision] ?? r.result.decision}
              </span>
              <span className="tabular">Recall {r.recall}</span>
              <span className="jf-ai-inline">{r.needs_vision ? "Vision, Claude Opus 5.5" : "No AI call"}</span>
            </p>
            <p className="jf-item-why">{decidedBy(r)}</p>
          </li>
        ))}
      </ul>
      <details className="jx-disc">
        <summary>What each case shows, and how it was run</summary>
        <div className="jx-body">
          {/* On a phone the list leaves out what each photo is; it is here, one press away. The table shows it inline. */}
          <ul className="jf-abouts">
            {runs.map((r) => (
              <li key={r.id}>
                <strong>{r.title}:</strong> {r.about}
              </li>
            ))}
          </ul>
          <p>
            The free checks run before any AI call: the photo&rsquo;s quality, and a 64-bit perceptual hash compared with the recall&rsquo;s official CPSC images and every earlier claim photo, in all eight orientations (four turns, each mirrored or not). A match within 10 bits asks for the owner&rsquo;s own photo, and within 4 bits of a picture published with any other recall or a photo claimed on one, the same. That catches the official picture, a turned and recompressed copy, a tilted and cropped copy, and a photo sent before. The same hash is then compared with the 1,777 distinct published pictures of every other recall, and with every photo already claimed on any recall at any firm, within 4 bits: a re-saved, halved or turned copy of a published picture stays within 2 bits, and none of the test photos that are not a published picture comes within 9. Between firms, only the hash is compared, never the photo.
          </p>
          <p>
            The vision check reads the photo against the proof rule: the product, each required action, and signs of a screen or printout. The decision, the amount and the payment route are plain code. Unclear cases go to two independent AI reviewers and a referee, and then to a person at the firm.
          </p>
          {runs
            .filter((r) => r.settings)
            .map((r) => (
              <p key={r.id}>
                <strong>{r.title}:</strong> {r.settings} {r.result.summary.plain}
              </p>
            ))}
          {replay && (
            <p>
              The cord-cut case is the owner flow&rsquo;s recorded answer for this photo, read with the recall&rsquo;s official pictures and replayed through the verifier, so it matches the Try page and the home page. Its time is that one live call.
            </p>
          )}
          <p className="tabular">
            Recorded {new Date(RUNS.recordedAt).toLocaleDateString("en-US", { dateStyle: "long" })} by scripts/public/record-runs.ts. The two vision runs cost ${RUNS.totalUsd.toFixed(2)} together. The user&rsquo;s own photos of products made safe are added as they are taken.
          </p>
        </div>
      </details>
    </>
  );
}
