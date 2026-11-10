import Link from "next/link";
import { fmtInt } from "@/lib/api/format";
import { estimateTotal } from "@/lib/label/cost";
import cases from "../../../content/label/photo-eval-cases.json";
import run from "../../../content/public/label-eval.json";

/**
 * "Is it recalled? Snap the label", measured (content/public/label-eval.json, written by scripts/label/eval-catalog.ts
 * with no model call): owner-style readings of every recall's own model numbers and UPCs, and products no recall lists.
 * Shown on /evidence#label; tests/label-eval.test.ts runs a slice of it again.
 */
export function labelEvalSentence() {
  return run.sentence;
}

const ROWS: { kind: string; what: string }[] = [
  { kind: "model_brand", what: "Brand and model number, as on a rating label" },
  { kind: "model_ocr", what: "The model with spaces, dashes or case changed" },
  { kind: "upc", what: "The UPC alone" },
  { kind: "upc_no_zero", what: "The UPC with its leading zero dropped" },
];
const NEG: { kind: string; what: string }[] = [
  { kind: "changed_model", what: "Each recall's model with its digits changed, with the brand" },
  { kind: "ordinary", what: "Everyday products with their brand and model" },
];

export function LabelEval() {
  const p = run.positives;
  const n = run.negatives;
  const by = p.byKind as Record<string, { n: number; ok: number; candidates: number; shared: number }>;
  const nby = n.byKind as Record<string, { n: number; ok: number; candidates: number }>;
  const photos = cases.cases;
  const withRecall = photos.filter((c) => c.expect.recall).length;
  return (
    <div className="ev-label">
      <p className="page-prose tabular">
        An owner who does not know a product is recalled can photograph its label. Claude reads the brand, product, model numbers and UPC, each with the text it was read from; plain code then looks them up in every recall&rsquo;s own codes, and a model number or UPC in a recall&rsquo;s list settles it. Measured
        in code over all {fmtInt(run.catalog.recalls)} recalls, with no AI call: for the {fmtInt(run.catalog.withCodes)} that list a model number or UPC, label readings built from their own codes found the right recall {fmtInt(p.ok)} times in {fmtInt(p.n)} ({fmtInt(p.shared)} of them a code that more than one recall lists, where the owner picks), and{" "}
        {fmtInt(n.ok)} of {fmtInt(n.n)} products no recall lists matched no recall.
      </p>
      <div className="jb-wrap" data-ui role="region" aria-label="Label readings by kind, and how many found their recall" tabIndex={0}>
        <table className="jb">
          <caption className="sr-only">Label readings by kind: how many found the right recall, and for products no recall lists, how many matched none</caption>
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col" className="jb-num">
                Readings
              </th>
              <th scope="col" className="jb-num">
                Right answer
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.filter((r) => by[r.kind]).map((r) => (
              <tr key={r.kind}>
                <th scope="row">{r.what}</th>
                <td className="jb-num tabular">{fmtInt(by[r.kind].n)}</td>
                <td className="jb-num tabular">{fmtInt(by[r.kind].ok)} found the recall</td>
              </tr>
            ))}
            {NEG.filter((r) => nby[r.kind]).map((r) => (
              <tr key={r.kind}>
                <th scope="row">{r.what}</th>
                <td className="jb-num tabular">{fmtInt(nby[r.kind].n)}</td>
                <td className="jb-num tabular">{fmtInt(nby[r.kind].ok)} matched no recall</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-note tabular">
        Same brand and product with another model number never counts as a match: those {fmtInt(nby.changed_model?.candidates ?? 0)} answers show the close recalls for the owner to compare. A photo eval of {photos.length} real label pictures ({withRecall} CPSC recall pictures with the recall each must find, and {photos.length - withRecall} adapter labels no recall lists) has its
        answers written down first, in content/label/photo-eval-cases.json; one reading each costs about ${estimateTotal(photos).toFixed(2)} in all.{" "}
        <Link className="text-link" href="/claim#snap">
          Try it with a sample label
        </Link>
      </p>
    </div>
  );
}
