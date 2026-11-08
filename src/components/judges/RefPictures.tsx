import { fmtDate } from "@/lib/api/format";
import { LIMITS } from "@/lib/verify/checks";
import samples from "../../../content/recalls/samples.json";
import { referencePictures } from "./errors";

const OUTCOME: Record<string, string> = { verified: "verified", firm_review: "sent to a person at the firm", retake: "a new photo asked for" };
const outcome = (decision: string, by: string) => `${OUTCOME[decision] ?? decision}${decision === "verified" && by === "reviewers" ? " by the two reviewers" : ""}`;
const c1 = (n: number | null) => (n === null ? "none" : n.toFixed(2));

/**
 * The sample recall's reference pictures, why they changed, and the right-product score (C1) the sample charger with
 * its cord cut got before and after, from the two recorded runs named in content/verify/sample-references.json.
 */
export function RefPictures() {
  const ref = referencePictures();
  const imgs = (samples as { recalls: { number: string; images: { thumb?: string; url: string; caption: string }[] }[] }).recalls.find((r) => r.number === "BH-2026-01")?.images ?? [];
  const rows = [
    { run: "Recorded preset", before: ref.before.preset, after: ref.after.preset },
    ...ref.after.trials.map((t, i) => ({ run: `Sweep trial ${t.trial}`, before: ref.before.trials[i] ?? null, after: t })),
  ];
  const range = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return lo === hi ? c1(lo) : `${c1(lo)} to ${c1(hi)}`;
  };
  const before = [ref.before.preset.c1, ...ref.before.trials.map((t) => t.c1)];
  const after = [ref.after.preset.c1, ...ref.after.trials.map((t) => t.c1)];
  const afterVerified = [ref.after.preset, ...ref.after.trials].filter((t) => t.decision === "verified").length;
  const under = [...before, ...after].every((x) => x !== null && x < LIMITS.productPass);
  return (
    <>
      <p className="page-prose">{ref.why}</p>
      <ul className="ev-refs" aria-label="The sample recall's reference pictures">
        {imgs.map((i) => (
          <li key={i.url}>
            <figure>
              <img src={i.thumb ?? i.url} alt={i.caption} width={160} height={120} loading="lazy" />
              <figcaption>{i.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <p className="page-prose">
        Right-product score for the sample charger with its cord cut: <strong className="tabular">{range(before)}</strong> with the earlier pictures, <strong className="tabular">{range(after)}</strong> with these, in{" "}
        {after.length} runs each.{under ? ` Both stay under the ${LIMITS.productPass} pass mark, so the two reviewers look closer each time.` : ""} With these pictures, {afterVerified} of {after.length}{" "}
        {afterVerified === 1 ? "was" : "were"} verified{after.length > afterVerified ? `, and ${after.length - afterVerified === 1 ? "one was" : `${after.length - afterVerified} were`} sent to a person at the firm` : ""}. The pass marks and the prompts did not change.
      </p>
      <div className="jb-wrap" role="region" aria-label="Right-product score before and after the reference pictures changed" tabIndex={0}>
        <table className="jb">
          <caption className="sr-only">Right-product score and outcome for each run, before and after {fmtDate(ref.changedAt)}</caption>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Before, right product</th>
              <th scope="col">Before, outcome</th>
              <th scope="col">After, right product</th>
              <th scope="col">After, outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.run}>
                <th scope="row">{r.run}</th>
                <td className="jb-num tabular">{c1(r.before?.c1 ?? null)}</td>
                <td>{r.before ? outcome(r.before.decision, r.before.decidedBy) : "none"}</td>
                <td className="jb-num tabular">{c1(r.after.c1)}</td>
                <td>{outcome(r.after.decision, r.after.decidedBy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-note">
        Changed {fmtDate(ref.changedAt)}. Before: {ref.before.files.join(" and ")}. After: {ref.after.files.join(" and ")}. Why and which pictures: {ref.file}; credits in public/samples/charger/CREDITS.json.
      </p>
    </>
  );
}
