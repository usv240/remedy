import { fmtDate } from "@/lib/api/format";
import { compareReviewerModels, reviewerModels, type ModelRow, type ReviewerModelsFile, type RunSummary } from "./reviewer-models";

/** "claude-sonnet-5-5" as people say it: "Claude Sonnet 5.5". Any other id is shown as the API gave it. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  return m ? `Claude ${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}
const shortName = (id: string) => modelName(id).replace(/^Claude /, "");

/** The three photos in plain words, in the order the page names them; any other case falls back to its id. */
const CASE_WORDS: Record<string, string> = {
  "look-alike-hair-dryer": "a look-alike hair dryer",
  "made-safe-hair-dryer-cord-cut": "the CPSC's own photo of the recall 26125 hair dryer with its cord cut",
  "sample-charger-cut": "Brightline's sample charger with its cord cut",
};
const CASE_SHORT: Record<string, string> = {
  "look-alike-hair-dryer": "the look-alike hair dryer",
  "made-safe-hair-dryer-cord-cut": "the CPSC's hair dryer photo",
  "sample-charger-cut": "the sample charger",
};
const KNOWN_WORDS: Record<ModelRow["known"], string> = { not_paid: "known answer: do not pay", reading: "a reading, in neither money rate", paid: "known answer: pay" };
const KNOWN_ORDER: ModelRow["known"][] = ["not_paid", "reading", "paid"];

const usd4 = (x: number) => `$${x.toFixed(4)}`;
const usd2 = (x: number) => `$${x.toFixed(2)}`;
const of = (t: { count: number; of: number }) => `${t.count} of ${t.of}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const reviewed = (r: ModelRow) => r.votes?.length === 2;
const sameAnswer = (r: ModelRow) => r.votes?.[0]?.answer === r.votes?.[1]?.answer;

/** Which reviewer runs on what in a run, as the column heads say it: "Both on Opus 5.5", "Remedy reviewer on Sonnet 5.5". */
function runLabel(run: RunSummary, first: RunSummary): string {
  const [p, m] = [run.models.product.join(" and "), run.models.remedy.join(" and ")];
  if (p === m) return `Both on ${shortName(p)}`;
  const changed = (["product", "remedy"] as const).filter((w) => run.models[w].join() !== first.models[w].join());
  const who = changed.length ? changed : (["product", "remedy"] as const);
  return who.map((w) => `${w === "product" ? "Product" : "Remedy"} reviewer on ${shortName(run.models[w].join(" and "))}`).join(", ");
}

/**
 * The two reviewers on one model and on two, from content/verify/reviewer-models.json through
 * src/components/evidence/reviewer-models.ts. Every figure and every sentence below is built from the file's rows each
 * time the page is built; tests/reviewer-models.test.ts reads the file again and checks them. Null before the first run.
 */
export function reviewerModelsSection(file: ReviewerModelsFile | null = reviewerModels()) {
  if (!file) return null;
  const rows = file.cases;
  const notes = Object.fromEntries(file.configs.map((c) => [c.id, c.note]));
  const comparison = compareReviewerModels(rows, notes);
  const [a, b] = comparison.runs;
  const configOf = (id: string) => file.configs.find((c) => c.id === id);
  const isDefault = (id: string) => Object.keys(configOf(id)?.env ?? {}).length === 0;
  const modelA = modelName(a.models.remedy.join(" and "));
  const modelB = modelName(b.models.remedy.join(" and "));
  const envB = Object.keys(configOf("B")?.env ?? {}).join(" and ");

  // The photos, in the order of their known answers, and how the two reviewers answered on each in the first run.
  const caseIds = [...new Set(rows.map((r) => r.case))].sort((x, y) => KNOWN_ORDER.indexOf(rows.find((r) => r.case === x)!.known) - KNOWN_ORDER.indexOf(rows.find((r) => r.case === y)!.known));
  const knownOf = (id: string) => rows.find((r) => r.case === id)!.known;
  const perCase = caseIds.map((id) => {
    const mine = rows.filter((r) => r.config === "A" && r.case === id && reviewed(r));
    return { id, reviewed: mine.length, same: mine.filter(sameAnswer).length };
  });
  const differed = perCase.filter((c) => c.reviewed > 0 && c.same === 0);
  const agreed = perCase.filter((c) => c.reviewed > 0 && c.same === c.reviewed);
  const sumOf = (cs: typeof perCase) => cs.reduce((s, c) => s + c.reviewed, 0);
  const names = (cs: typeof perCase) => list(cs.map((c) => CASE_SHORT[c.id] ?? c.id));

  // The photo that should be paid, and why the first run held it when it did.
  const payId = caseIds.find((id) => knownOf(id) === "paid");
  const heldA = rows.filter((r) => r.config === "A" && r.known === "paid" && r.decision !== "verified");
  const heldUnfinished = heldA.filter((r) => r.decision === "firm_review" && !reviewed(r)).length;
  // A claim the reviewers were asked about but did not answer goes to a person (src/lib/verify/index.ts).
  const unfinished = (id: string) => rows.filter((r) => r.config === id && r.decision === "firm_review" && !reviewed(r)).length;

  const trials = file.trials;
  const claims = a.claims;
  const intro = `The claim path's own setting, run twice: first with both reviewers on ${modelA}, the default, then with the Remedy reviewer on ${modelB} (${envB}) and the Product reviewer unchanged.`;
  const photos =
    `Both runs read the ${caseIds.length} photos that reach the two reviewers, ${trials} trials each: ${list(caseIds.map((id) => `${CASE_WORDS[id] ?? id} (${KNOWN_WORDS[knownOf(id)]})`))}. ` +
    `The second run re-read the photo check and the Product reviewer's vote from the first run's replay cache, so the Remedy reviewer's model is the only difference.`;

  const noSafer = b.wrongPay.count >= a.wrongPay.count;
  const heldEvery = b.wrongHold.of > 0 && b.wrongHold.count === b.wrongHold.of;
  const shows =
    noSafer && b.wrongHold.count > a.wrongHold.count
      ? `A second model made the pair no safer on these photos: neither run paid a photo it should not have (${of(a.wrongPay)} and ${of(b.wrongPay)}), and with the Remedy reviewer on ${modelB} ${CASE_SHORT[payId ?? ""] ?? "the photo that should be paid"}, the one photo here that should be paid, went to a person ${heldEvery ? `in every trial (${of(b.wrongHold)})` : `in ${of(b.wrongHold)} trials`}, so both reviewers stay on ${modelA}.`
      : `On these photos the first run paid wrongly in ${of(a.wrongPay)} and held back ${of(a.wrongHold)}; the second, ${of(b.wrongPay)} and ${of(b.wrongHold)}.`;
  const independence =
    differed.length && agreed.length
      ? `The two reviewers' independence comes from the different rulebook each reads: on ${modelA} they gave different answers on ${names(differed)} in all ${sumOf(differed)} claims they reviewed, and the same answer on ${names(agreed)} in all ${sumOf(agreed)}.`
      : `The two reviewers' independence comes from the different rulebook each reads, one the recall's official pictures and the other the remedy text.`;
  const heldWhy = heldA.length
    ? `On ${modelA} the photo that should be paid was held ${heldA.length === 1 ? "once" : `${heldA.length} times`} (${of(a.wrongHold)})${heldUnfinished === heldA.length ? `, in ${heldA.length === 1 ? "a trial" : "trials"} where the reviewers did not finish, and a claim the reviewers do not finish goes to a person` : ""}.`
    : "";
  const small = `The sample is small, ${caseIds.length} photos and ${trials} trials (${claims} claims a run), so it shows how the two settings behaved on these photos rather than a rate.`;

  const spend = file.aiUsage
    ? `The run's model calls cost ${usd2(file.aiUsage.usd)} over ${file.aiUsage.calls} calls in the usage log (${usd2(file.spentUsd)} by the sweep's own count of its live calls).`
    : `The run paid ${usd2(file.spentUsd)} for its live calls.`;
  const denominators =
    a.reviewed !== b.reviewed
      ? `The reviewers did not finish on ${unfinished("A")} ${unfinished("A") === 1 ? "claim" : "claims"} in the first run and on ${unfinished("B") || "none"} in the second, each sent to a person, so the first run has ${a.reviewed} reviewed claims and the second ${b.reviewed}.`
      : "";

  const runs = [a, b].map((r) => ({
    id: r.id,
    label: runLabel(r, a),
    isDefault: isDefault(r.id),
    same: `${r.sameAnswer} of ${r.reviewed}`,
    wrongPay: of(r.wrongPay),
    wrongHold: of(r.wrongHold),
    usdPerClaim: usd4(r.usdPerClaim),
  }));

  // The table in one sentence, for docs/results.md.
  const [ra, rb] = runs;
  const long = (l: string) => l.replace(/^Both on /, "both reviewers on ").replace(/^(Product|Remedy) reviewer/, "the $1 reviewer");
  const lead = long(ra.label);
  const figures = `${lead.charAt(0).toUpperCase()}${lead.slice(1)} against ${long(rb.label)}: the same answer from both reviewers on ${ra.same} reviewed claims against ${rb.same}; paid when it should not have been, ${ra.wrongPay} against ${rb.wrongPay}; held when it could have been paid, ${ra.wrongHold} against ${rb.wrongHold}; ${ra.usdPerClaim} against ${rb.usdPerClaim} a claim at list price.`;

  return { file, comparison, runs, env: envB, intro, photos, figures, shows, independence, heldWhy, small, spend, denominators, ranAt: file.ranAt, caseIds, trials };
}

/** Shown on /evidence/photo-checks#reviewer-models, below where the two-reviewer design comes from. No model call. */
export function ReviewerModels() {
  const s = reviewerModelsSection();
  if (!s) return null;
  // The setting's name is code, and may break anywhere on a phone.
  const at = s.env ? s.intro.indexOf(s.env) : -1;
  const [introBefore, introAfter] = at < 0 ? [s.intro, ""] : [s.intro.slice(0, at), s.intro.slice(at + s.env.length)];
  const MEASURES: { label: string; key: "same" | "wrongPay" | "wrongHold" | "usdPerClaim" }[] = [
    { label: "Same answer from both reviewers", key: "same" },
    { label: "Paid when it should not have been", key: "wrongPay" },
    { label: "Held when it could have been paid", key: "wrongHold" },
    { label: "Cost per claim, list price", key: "usdPerClaim" },
  ];
  return (
    <>
      <p className="page-prose jp-intro">
        {introBefore}
        <code className="rvm-env">{s.env}</code>
        {introAfter}
      </p>
      <p className="page-prose">{s.photos}</p>
      <div className="jb-wrap rvm-wrap" role="region" aria-label="The two reviewers on one model and on two" tabIndex={0}>
        <table className="jb rvm">
          <caption className="sr-only">Each run of the comparison: how often the two reviewers gave the same answer, the two money mistakes, and the cost per claim</caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              {s.runs.map((r) => (
                <th key={r.id} scope="col" className="jb-num" data-ours={r.isDefault ? "" : undefined}>
                  {r.label}
                  {r.isDefault ? <span className="rvm-default"> (the default)</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEASURES.map((m) => (
              <tr key={m.key}>
                <th scope="row">{m.label}</th>
                {s.runs.map((r) => (
                  <td key={r.id} className="jb-num tabular" data-ours={r.isDefault ? "" : undefined}>
                    {r[m.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-prose">
        <strong>What it shows.</strong> {s.shows}
      </p>
      <p className="page-prose">
        {s.independence} {s.small}
      </p>
      <p className="page-note">
        {s.heldWhy} {s.denominators} Counted by src/components/evidence/reviewer-models.ts from content/verify/reviewer-models.json (scripts/verify/sweep.ts --claim-path, run {fmtDate(s.ranAt)}), against the known answers in
        content/verify/fixtures/cases.json; cost per claim is the list price of every model call a claim makes, the photo check and any reviewers. {s.spend} tests/reviewer-models.test.ts counts the file again.
      </p>
    </>
  );
}
