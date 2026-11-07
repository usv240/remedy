/**
 * What the AI never decides, and what it does instead. Each line names the file where that decision lives, shown in
 * the Technical view; every claim here was checked against that file.
 */
const CODE: { what: string; where: string }[] = [
  { what: "Whether a claim is paid, sent to a person, or asked for a new photo", where: "src/lib/verify/decide.ts" },
  { what: "Every pass mark, such as 0.85 for the right product", where: "src/lib/verify/checks.ts (LIMITS)" },
  { what: "The refund amount: the firm's or the purchase's, whichever is lower", where: "computeAmount in src/lib/verify/checks.ts; src/lib/payments/router.ts" },
  { what: "Which recall and proof rule apply: the claim's recall and its stored rule", where: "ruleFor in src/app/api/claims/_lib/recall.ts" },
  { what: "The marker word, model and lot ranges, claim limits, and photo matches", where: "src/lib/verify/checks.ts, identifiers.ts, dhash.ts" },
  { what: "When money moves and to whom: the auto-approve cap, a refund to the purchase inside 180 days, or a payout", where: "planPayment in src/lib/payments/router.ts" },
  { what: "Deleting a photo that shows a person, and every owner's photo 90 days after the decision", where: "src/lib/ops/photos.ts" },
];

const MODEL: { what: string; where: string }[] = [
  { what: "Reads each remedy into a proof rule, once, before any claim", where: "src/lib/recall/proof-rule.ts (Message Batches API)" },
  { what: "Describes the photo: the match, each step, any writing or label, camera or screen, and any person in it", where: "src/lib/verify/vision.ts" },
  { what: "Two reviewers cite what they see when a check is unclear; a referee in code counts only votes whose evidence checks out", where: "src/lib/verify/reviewers.ts" },
  { what: "Reads unclear catalog rows; Claude Haiku 5.5 writes the monthly report's summary from SQL counts", where: "src/lib/recall/scan.ts, src/lib/firm/narrative.ts" },
];

export function NeverDecides() {
  return (
    <div className="jn">
      <div className="jn-col">
        <h3 className="jn-h">Plain code decides</h3>
        <ul className="jn-list">
          {CODE.map((c) => (
            <li key={c.what}>
              {c.what}
              <span className="jn-where lp-tech">{c.where}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="jn-col">
        <h3 className="jn-h">Claude reads and describes</h3>
        <ul className="jn-list">
          {MODEL.map((c) => (
            <li key={c.what}>
              {c.what}
              <span className="jn-where lp-tech">{c.where}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
