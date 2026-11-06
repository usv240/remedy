import { fmtMs } from "@/lib/api/format";
import { RUNS, type RunRow } from "./data";

const DECISION: Record<string, string> = { verified: "Verified", retake: "Asked for a new photo", firm_review: "A person at the firm looks" };
/** Which checks settled it, in plain words, read from the recorded checks themselves. */
function decidedBy(r: RunRow): string {
  const c = r.result.checks;
  const parts: string[] = [];
  if (r.result.decided_by === "own_photo") parts.push("Your own photo: it matches the recall's official picture");
  if (r.result.decided_by === "quality") parts.push("Photo quality");
  if (r.result.decided_by !== "own_photo" && c.C3?.status === "fail") parts.push("it matches a photo sent with an earlier claim");
  if (c.C1?.status === "fail") parts.push(`Right product, scored ${c.C1.score?.toFixed(2) ?? "low"}`);
  if (c.C1?.status === "unclear") parts.push(`Right product unclear, scored ${c.C1.score?.toFixed(2) ?? ""}`);
  if (r.result.decided_by === "made_safe" || c.C2?.status === "fail") parts.push("not yet made safe");
  if (r.result.decided_by === "reviewers") parts.push("Two reviewers");
  const s = parts.join("; ") || r.result.decided_by;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Every recorded run of the verifier on the fixture photos: what it was, what it decided, which check decided it. */
export function PhotoChecks() {
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
            {RUNS.runs.map((r) => (
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
      <details className="jx-disc">
        <summary>What each case shows, and how it was run</summary>
        <div className="jx-body">
          <p>
            The free checks run before any AI call: the photo&rsquo;s quality, and a 64-bit perceptual hash compared with the recall&rsquo;s official CPSC images and every earlier claim photo, in all four quarter turns. A match within 10 bits asks for the owner&rsquo;s own photo. That catches the official picture, a turned and recompressed copy, a tilted and cropped copy, and a photo sent before.
          </p>
          <p>
            The vision check reads the photo against the proof rule: the product, each required action, and signs of a screen or printout. The decision, the amount and the payment route are plain code. Unclear cases go to two independent AI reviewers and a referee, and then to a person at the firm.
          </p>
          {RUNS.runs
            .filter((r) => r.settings)
            .map((r) => (
              <p key={r.id}>
                <strong>{r.title}:</strong> {r.settings} {r.result.summary.plain}
              </p>
            ))}
          <p className="tabular">
            Recorded {new Date(RUNS.recordedAt).toLocaleDateString("en-US", { dateStyle: "long" })} by scripts/public/record-runs.ts. The two vision runs cost ${RUNS.totalUsd.toFixed(2)} together. The user&rsquo;s own photos of products made safe are added as they are taken.
          </p>
        </div>
      </details>
    </>
  );
}
