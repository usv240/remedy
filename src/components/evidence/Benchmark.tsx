import { fmtInt } from "@/lib/api/format";
import { BENCH, FIELD_NAMES, VARIANTS, extraction, pct } from "./data";

/** The extraction benchmark: three readers on 130 real CPSC remedies, field by field. The labels are a draft. */
export function Benchmark() {
  const ex = extraction();
  return (
    <>
      <p className="jb-draft" role="note">
        Draft: scored against draft labels; final labels are being checked by hand.
      </p>
      <div className="jb-wrap" data-ui role="region" aria-label="Benchmark, accuracy by field" tabIndex={0}>
        <table className="jb">
          <caption className="sr-only">Share of the {BENCH.sample.items} remedies each reader got right, by field</caption>
          <thead>
            <tr>
              <th scope="col">Field</th>
              {VARIANTS.map((v) => (
                <th key={v.id} scope="col" className="jb-num" data-ours={v.id === "claude_selfcheck" ? "" : undefined}>
                  {v.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="jb-total">
              <th scope="row">Every field right</th>
              {VARIANTS.map((v) => {
                const a = BENCH.variants[v.id].allFieldsCorrect;
                return (
                  <td key={v.id} className="jb-num tabular" data-ours={v.id === "claude_selfcheck" ? "" : undefined}>
                    {pct(a.rate)} <span className="muted">({a.count})</span>
                  </td>
                );
              })}
            </tr>
            {BENCH.fields.map((f) => (
              <tr key={f}>
                <th scope="row">{FIELD_NAMES[f] ?? f}</th>
                {VARIANTS.map((v) => (
                  <td key={v.id} className="jb-num tabular" data-ours={v.id === "claude_selfcheck" ? "" : undefined}>
                    {pct(BENCH.variants[v.id].fields[f])}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Photo-refund remedies only</th>
              {VARIANTS.map((v) => (
                <td key={v.id} className="jb-num tabular" data-ours={v.id === "claude_selfcheck" ? "" : undefined}>
                  {pct(BENCH.variants[v.id].byKind.photo_refund.allFieldsCorrect.rate)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Cost for the {BENCH.sample.items}</th>
              {VARIANTS.map((v) => (
                <td key={v.id} className="jb-num tabular" data-ours={v.id === "claude_selfcheck" ? "" : undefined}>
                  ${BENCH.variants[v.id].usdForSample.toFixed(2)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <details className="jx-disc">
        <summary>How it was scored, and what the labels are</summary>
        <div className="jx-body">
          <p>
            A stratified random sample of {BENCH.sample.photoRefund} photo-refund remedies and {BENCH.sample.nonPhoto} others from the CPSC data, which we did not write. {BENCH.scoring}
          </p>
          <p>
            The labels come from a separate Claude pass at high effort that quotes its evidence, cross-checked by deterministic rules. No label has been confirmed by a person yet, so the Claude scores partly measure agreement between two Claude passes; the keyword rules&rsquo; score does not depend on who labelled.
          </p>
          <ul className="jb-variants">
            {VARIANTS.map((v) => (
              <li key={v.id}>
                <strong>{v.name}.</strong> {v.about}
              </li>
            ))}
          </ul>
          <p className="tabular">
            All {fmtInt(ex.counts.recalls)} stored rules ({fmtInt(ex.counts.photoRefund)} photo-refund recalls and the rest for the benchmark and recent recalls) took {fmtInt(ex.usage.calls)} calls through the Message Batches API: {fmtInt(ex.usage.inputTokens)} input and {fmtInt(ex.usage.outputTokens)} output tokens, ${ex.usage.usd.toFixed(2)} at batch prices, in {ex.minutes} minutes.
          </p>
          <p>
            Scored {new Date(BENCH.scoredAt).toLocaleDateString("en-US", { dateStyle: "long" })}. Files: content/recalls/benchmark/results.json, sample.json and labels.draft.json; the runner is scripts/recalls/bench.ts.
          </p>
        </div>
      </details>
    </>
  );
}
