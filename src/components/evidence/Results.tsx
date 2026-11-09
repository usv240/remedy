import { fmtInt } from "@/lib/api/format";
import { HEADLINE } from "@/lib/recall/headline";
import { BENCH, RUNS, S, freeCaught, pct } from "./data";

/**
 * The results band, above the fold: the CPSC count, the extraction benchmark (labelled draft), the photo checks and
 * the gap Remedy fills. Each links to the section below that shows it in full.
 */
export function Results() {
  const sc = BENCH.variants.claude_selfcheck;
  const base = BENCH.variants.baseline;
  const free = freeCaught();
  const unrelated = RUNS.runs.find((r) => r.id === "unrelated-object");
  return (
    <ul id="results" className="jr" aria-label="Results">
      <li className="jr-item">
        <a className="jr-link" href="#data">
          <span className="jr-fig tabular">
            {fmtInt(HEADLINE.count)} of {fmtInt(S.recalls.count)}
          </span>
          <span className="jr-what">US product recalls since January 2024 refund an owner for a photo of the product made safe.</span>
          <span className="jr-base">
            <span className="tabular">{HEADLINE.byYear["2024"]}</span> in 2024, <span className="tabular">{HEADLINE.byYear["2026"]}</span> in 2026 so far. CPSC Recalls API and each recall&rsquo;s proof rule.
          </span>
        </a>
      </li>
      <li className="jr-item">
        <a className="jr-link" href="#benchmark">
          <span className="jr-fig tabular">
            {sc.allFieldsCorrect.count} of {sc.n}
          </span>
          <span className="jr-what">real CPSC remedies read with every field right by Claude with a self-check.</span>
          <span className="jr-base">
            Keyword rules: <span className="tabular">{base.allFieldsCorrect.count}</span> of {base.n}. <span className="jr-draft">Draft labels</span>
          </span>
        </a>
      </li>
      <li className="jr-item">
        <a className="jr-link" href="#photo-checks">
          <span className="jr-fig tabular">
            {free.caught} of {free.total}
          </span>
          <span className="jr-what">reused, copied or unclear photos stopped before any AI call: a new photo asked for, or a person at the firm.</span>
          <span className="jr-base">
            {unrelated ? (
              <>
                A photo of a mug for the power bank recall: right product scored <span className="tabular">{unrelated.result.checks.C1.score?.toFixed(2)}</span>, not paid.
              </>
            ) : (
              "Official images, rotated and cropped copies, a photo already used, a blurry photo."
            )}
          </span>
        </a>
      </li>
      <li className="jr-item">
        <a className="jr-link" href="/evidence/market#adoption">
          <span className="jr-fig tabular">{S.all.paypalOrVenmo.count}</span>
          <span className="jr-what">recalls mention PayPal or Venmo. The photo goes to an email address in <span className="tabular">{S.photoRefund.email.count}</span> of the {fmtInt(S.all.photoRefund.count)} recalls whose remedy names a photo and a refund.</span>
          <span className="jr-base">
            <span className="tabular">{pct(S.all.under50k.share / 100)}</span> of all recalls cover fewer than 50,000 units.
          </span>
        </a>
      </li>
    </ul>
  );
}
