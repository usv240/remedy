import type { PublicRecall } from "@/app/api/claims/_lib/recall";
import { ClaimInfo } from "./ClaimInfo";
import { day } from "./format";

/** Step 1, "Your recall": the official picture, the product, the hazard in one sentence and the recall number. */
export function RecallCard({ recall, compact = false }: { recall: PublicRecall; compact?: boolean }) {
  const img = recall.images[0];
  return (
    <div className="cl-recall" data-compact={compact ? "" : undefined} data-ui>
      <div className="cl-recall-top" data-img={img ? "" : undefined}>
        {img && (
          // eslint-disable-next-line @next/next/no-img-element -- local CPSC thumbnail, credited below
          <img className="cl-recall-img" src={img.src} alt={img.caption || `The recalled ${recall.product}`} />
        )}
        <div className="cl-recall-id">
          <p className="cl-recall-product">{recall.product}</p>
          <p className="cl-recall-number">
            <span className="tabular">Recall {recall.number}</span>
            <ClaimInfo k="claim.recall" topic={`recall ${recall.number}`} />
          </p>
          <p className="cl-recall-hazard">{recall.hazard}</p>
        </div>
      </div>
      {img && !compact && (
        <p className="cl-recall-cap">
          {img.caption ? `${img.caption}. ` : ""}Image: US Consumer Product Safety Commission.
        </p>
      )}
      {!compact && (
        <dl className="cl-facts">
          <div>
            <dt>Recalled</dt>
            <dd className="tabular">{day(recall.date)}</dd>
          </div>
          {recall.unitsText && (
            <div>
              <dt>Units</dt>
              <dd className="tabular">{recall.unitsText}</dd>
            </div>
          )}
          {recall.model && (
            <div>
              <dt>Models</dt>
              <dd>{recall.model}</dd>
            </div>
          )}
        </dl>
      )}
      {!compact && (
        <details className="cl-remedy">
          <summary>
            <span className="cl-remedy-k">The remedy, in the CPSC&rsquo;s words</span>
            {/* Closed, the first line of the quote shows under the label, so it reads as a quote to open, not a heading. */}
            <span className="cl-remedy-peek" aria-hidden="true">
              &ldquo;{recall.remedyText}&rdquo;
            </span>
          </summary>
          <blockquote>{recall.remedyText}</blockquote>
          <p className="cl-hint">
            {recall.sample ? (
              "Sample recall; the firm and the recall are fictional."
            ) : (
              <a className="text-link" href={recall.url} target="_blank" rel="noreferrer">
                Read recall {recall.number} on cpsc.gov
              </a>
            )}
          </p>
        </details>
      )}
    </div>
  );
}
