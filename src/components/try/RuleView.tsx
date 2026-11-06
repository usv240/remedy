import type { PublicRecall } from "@/app/api/claims/_lib/recall";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { StepArt } from "@/components/claim/StepArt";
import { markerWord, ownerSteps } from "@/components/claim/steps";

const ACTION: Record<string, string> = {
  cut_cord: "Cut the cord",
  cut_in_half: "Cut it in half",
  write_recalled: "Write on it",
  remove_part: "Remove a part",
  puncture: "Puncture it",
  disassemble: "Take it apart",
  other: "Make it unusable",
};
const SHOW: Record<string, string> = {
  whole_product: "the whole product",
  label: "the label",
  model_number: "the model number",
  serial_or_lot: "the serial or lot number",
  date_code: "the date code",
  cut_or_damage: "the cut or damage",
  marking: "the writing",
};
const REMEDY: Record<string, string> = {
  full_refund: "Full refund",
  partial_refund: "Partial refund",
  replacement: "Replacement",
  repair: "Repair",
  refund_or_replacement: "Refund or replacement",
  other: "Other remedy",
};

/** A recall's proof rule, result first: what to do and what the photo shows, then each field with its confidence. */
export function RuleView({ recall }: { recall: PublicRecall }) {
  const r = recall.rule;
  const steps = ownerSteps(r);
  const word = markerWord(r) ?? undefined;
  return (
    <div className="tr-rule" data-ui>
      <p className="tr-rule-k">
        {recall.ruleSource === "ai" ? "Proof rule, read by Claude from the remedy" : "Proof rule, quick read"}
        <ClaimInfo k={recall.ruleSource === "ai" ? "claim.steps" : "try.quickread"} topic="the proof rule" />
      </p>
      <p className="tr-rule-plain">{r.explanation.plain}</p>
      <ol className="cl-todo">
        {steps.map((s) => (
          <li key={s.text} className="cl-todo-item">
            <StepArt kind={s.kind} word={word} />
            <p className="cl-todo-text">{s.text}</p>
          </li>
        ))}
      </ol>
      <dl className="tr-fields">
        <div>
          <dt>Photo needed</dt>
          <dd>{r.photo_required ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>What to do</dt>
          <dd>
            {r.actions.map((a) => ACTION[a] ?? a).join(", ") || "Nothing before the photo"}
            {r.marker_text ? `: write "${r.marker_text}"` : ""} <span className="tr-conf tabular">confidence {r.confidence.actions}</span>
          </dd>
        </div>
        <div>
          <dt>Photo shows</dt>
          <dd>
            {r.must_show.map((m) => SHOW[m] ?? m).join(", ") || "No photo"} <span className="tr-conf tabular">confidence {r.confidence.must_show}</span>
          </dd>
        </div>
        <div>
          <dt>Remedy</dt>
          <dd>
            {REMEDY[r.remedy] ?? r.remedy}
            {r.refund_amount_text ? `, "${r.refund_amount_text}"` : ""} <span className="tr-conf tabular">confidence {r.confidence.remedy}</span>
          </dd>
        </div>
        <div>
          <dt>Sent by</dt>
          <dd>{r.contact_channel.replace("_", " ")}</dd>
        </div>
      </dl>
      <p className="cl-tech cl-hint">{r.explanation.technical}</p>
    </div>
  );
}
