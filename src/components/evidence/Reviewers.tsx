import { reviewerComparison, type RecordedVote, type ReviewedRow, type Tally } from "./reviewer-data";
import "./reviewers.css";

/** The same decision words as the claim page and the photo checks table. */
const DECISION: Record<string, string> = { verified: "Verified", retake: "Retake", firm_review: "Firm review" };
const KNOWN: Record<ReviewedRow["known"], string> = { paid: "Pay", not_paid: "Do not pay", reading: "Reading only" };
const SOURCE: Record<ReviewedRow["source"], string> = { sweep: "sweep", sample: "sample sweep", preset: "recorded preset" };
const tone = (d: string) => (d === "verified" ? "positive" : d === "retake" ? "attention" : "info");

const voteWords = (v: RecordedVote | undefined) => (v ? `${v.answer.replace(/_/g, " ")}, ${v.confidence.toFixed(2)}${v.counted ? "" : ", not counted"}` : null);
const refereeWords = (r: ReviewedRow) => (r.referee === "verify" ? "Both agree: pay" : r.referee === "person" ? "A person decides" : "");
const trialWords = (r: ReviewedRow) => (r.trial === null ? SOURCE[r.source] : `${SOURCE[r.source]}, trial ${r.trial}`);

function Counts({ t, lead }: { t: Tally; lead: string }) {
  return (
    <>
      <dt>{lead}</dt>
      <dd className="tabular">
        Paid when it should not have been: {t.wrongPay} of {t.notPaid}
      </dd>
      <dd className="tabular">
        Held when it could have been paid: {t.wrongHold} of {t.paid}
      </dd>
      <dd className="rv-k tabular">
        {t.rows} {t.rows === 1 ? "row" : "rows"}
      </dd>
    </>
  );
}

/**
 * One reviewer against the referee: the recorded rows at the claim path's setting that reached the two reviewers, what
 * the referee did with each, and what each reviewer alone would have done where its vote was kept
 * (src/components/evidence/reviewer-data.ts). No model call.
 */
export function Reviewers() {
  const c = reviewerComparison();
  const vote = (r: ReviewedRow, who: RecordedVote["reviewer"]) => voteWords(r.votes?.find((v) => v.reviewer === who));
  const held = c.reached.filter((r) => r.decision !== "verified").length;
  const conclusion = c.sameAsReferee
    ? `On the ${c.withVotes === 1 ? "one row" : `${c.withVotes} rows`} with recorded votes, either reviewer alone would have paid what the referee paid; the referee's extra step did not change a payment there. The referee's own record is wider: of the ${c.referee.rows} rows it saw, it sent ${held} to a person and paid none it should not have.`
    : `On the ${c.withVotes} rows with recorded votes, a single reviewer and the referee would have paid differently; the rows above show where.`;
  return (
    <>
      <p className="page-prose jp-intro tabular">
        At the claim path&rsquo;s setting, {c.rows.length} recorded decisions: {c.settled} were settled by the six checks before any reviewer ran, and {c.reached.length} went to the two reviewers and the referee. The sweep kept the referee&rsquo;s decision for
        every one of those; it kept what each reviewer said on its own in {c.withVotes === 1 ? "one row" : `${c.withVotes} rows`} (the recorded preset), so a single reviewer can be set against the referee only there. The sweep script now records both votes for the next run.
      </p>
      <div className="jb-wrap" data-ui role="region" aria-label="One reviewer against the referee" tabIndex={0}>
        <table className="jb rv">
          <caption className="sr-only">Each recorded row the two reviewers saw: the referee&rsquo;s decision, the final decision, the known answer, and each reviewer&rsquo;s own vote where it was kept</caption>
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Run</th>
              <th scope="col">Referee</th>
              <th scope="col">Final</th>
              <th scope="col">Known answer</th>
              <th scope="col">Product reviewer</th>
              <th scope="col">Remedy reviewer</th>
            </tr>
          </thead>
          <tbody>
            {c.reached.map((r) => (
              <tr key={`${r.source}-${r.caseId}-${r.trial ?? "p"}`}>
                <th scope="row">{r.caseId}</th>
                <td className="tabular">{trialWords(r)}</td>
                <td>{refereeWords(r)}</td>
                <td>
                  <span className="pill" data-tone={tone(r.decision)}>
                    {DECISION[r.decision] ?? r.decision}
                  </span>
                </td>
                <td>{KNOWN[r.known]}</td>
                <td className="tabular">{vote(r, "product") ?? <span className="rv-none">not recorded</span>}</td>
                <td className="tabular">{vote(r, "remedy") ?? <span className="rv-none">not recorded</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="rv-list" data-ui aria-label="One reviewer against the referee">
        {c.reached.map((r) => (
          <li key={`${r.source}-${r.caseId}-${r.trial ?? "p"}`} className="rv-item">
            <p className="rv-item-head">
              <span>{r.caseId}</span>
              <span className="pill" data-tone={tone(r.decision)}>
                {DECISION[r.decision] ?? r.decision}
              </span>
            </p>
            <p className="rv-item-meta">
              <span className="tabular">{trialWords(r)}</span>
              <span>{refereeWords(r)}</span>
              <span>Known answer: {KNOWN[r.known].toLowerCase()}</span>
            </p>
            <p className="rv-votes">
              {r.votes ? (
                <>
                  Product reviewer {vote(r, "product")}; Remedy reviewer {vote(r, "remedy")}.
                </>
              ) : (
                <span className="rv-none">Each reviewer&rsquo;s own vote was not recorded in this run.</span>
              )}
            </p>
          </li>
        ))}
      </ul>
      <dl className="rv-counts">
        <div>
          <Counts t={c.referee} lead="The referee, as designed" />
        </div>
        <div>
          <Counts t={c.product} lead="Product reviewer alone" />
        </div>
        <div>
          <Counts t={c.remedy} lead="Remedy reviewer alone" />
        </div>
      </dl>
      <p className="page-prose">
        {conclusion} The reason the two reviewers read two different rulebooks, and why a disagreement goes to a person, is in{" "}
        <a className="text-link" href="#lineage">
          where the design comes from
        </a>
        , below.
      </p>
      <p className="page-note">
        A reviewer alone pays when its vote says meets and the evidence check counted it. Known answers: Pay and Do not pay from content/verify/fixtures/cases.json; Reading only is a published picture sent with the official-picture match off, outside both money
        rates. Read by src/components/evidence/reviewer-data.ts from {c.sources.join(", ")}; tests/reviewers-recorded.test.ts counts the files again.
      </p>
    </>
  );
}
