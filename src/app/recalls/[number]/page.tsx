import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import demo from "../../../../content/recalls/demo-picks.json";
import { Info } from "@/components/Info";
import { fmtDate, fmtInt, shortTitle } from "@/lib/api/format";
import { extractionTrace, rawRecord, recallByNumber, recallDetail } from "@/lib/api/recall-data";
import { actionLabel, markerWord, percent, remedyLabel, showLabel } from "@/lib/api/rule-chips";
import "../../pages.css";
import "../../landing-shared.css";
import "../recalls.css";

/** The demo recalls and the CPSC's made-safe examples are prerendered; every other recall is rendered on first visit. */
export function generateStaticParams() {
  return [...new Set([...demo.picks.map((p) => p.number), "26125", "25007"])].map((number) => ({ number }));
}

export async function generateMetadata(props: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await props.params;
  const r = recallByNumber(number);
  if (!r) return { title: "Recall not found" };
  return { title: `Recall ${r.number}: ${shortTitle(r.title)}`, description: r.photoRefund ? `What recall ${r.number} asks you to do, the photo it needs, and the refund.` : `Recall ${r.number}: the hazard, the remedy and the official images.` };
}

export default function RecallPage(props: { params: Promise<{ number: string }> }) {
  return (
    <div className="page frame recall">
      <Link className="text-link rd-back" href="/recalls">
        All recalls
      </Link>
      <Suspense fallback={<p className="page-loading">Loading the recall…</p>}>
        <Detail params={props.params} />
      </Suspense>
    </div>
  );
}

const ACTION_WHY: Record<string, string> = {
  cut_cord: "A cut cord means it can never be plugged in again.",
  cut_in_half: "Cut in half, it cannot be worn or used again.",
  write_recalled: "The writing shows anyone who finds it that it is recalled.",
  remove_part: "Without that part, it cannot be used.",
  puncture: "The hole makes it unusable.",
  disassemble: "Taken apart, it cannot be used.",
  other: "This makes it unusable, as the recall asks.",
};

async function Detail({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const d = recallDetail(decodeURIComponent(number));
  if (!d) {
    return (
      <header className="page-head">
        <h1 className="page-title">We could not find recall {number}</h1>
        <p className="lede">Remedy covers US consumer product recalls since January 2024.</p>
        <p className="page-prose">
          <Link className="text-link" href={`/recalls?query=${encodeURIComponent(number)}`}>
            Search for it
          </Link>
          , or check the number on your recall notice.
        </p>
      </header>
    );
  }
  const rule = d.proof_rule;
  const trace = extractionTrace(d.number);
  const raw = rawRecord(d.number);
  const products = d.products.filter((p) => p.name);
  const low = (n: number) => n < 0.8;

  return (
    <>
      <header className="page-head rd-head">
        <div className="title-row">
          <h1 className="page-title rd-title">{shortTitle(d.title)}</h1>
        </div>
        <p className="rd-meta tabular">
          <span>Recall {d.number}</span>
          <span>{fmtDate(d.date)}</span>
          <span>{d.units_text || (d.units ? `${fmtInt(d.units)} units` : "Units not given")}</span>
          <span>{d.category}</span>
        </p>
        <p className="rd-flags">
          {d.photo_refund ? <span className="chip">Refund for a photo</span> : <span className="chip" data-quiet="">No photo needed</span>}
          {d.remedies.map((x) => (
            <span key={x} className="chip" data-quiet="">
              {x}
            </span>
          ))}
        </p>
        <p className="lede rd-lede">{d.hazard}</p>
        {d.photo_refund && (
          <div className="rd-cta">
            <Link className="btn btn-primary" href={d.claim_page}>
              Start a claim
            </Link>
            {d.sample ? (
              <span className="muted">Sample recall; the firm and the recall are fictional.</span>
            ) : (
              <a className="text-link" href={d.cpsc_url} target="_blank" rel="noreferrer">
                The recall on cpsc.gov
              </a>
            )}
          </div>
        )}
        {!d.photo_refund && (
          <div className="rd-cta">
            {d.sample ? (
              <span className="muted">Sample recall; the firm and the recall are fictional.</span>
            ) : (
              <a className="text-link" href={d.cpsc_url} target="_blank" rel="noreferrer">
                The recall on cpsc.gov
              </a>
            )}
          </div>
        )}
      </header>

      <div className="rd-grid">
        <div>
          <section id="rule" className="rd-sheet" data-ui aria-labelledby="rule-h">
            <h2 id="rule-h">
              {rule?.photo_required ? "What to do for your refund" : "What the recall asks"} <Info id="recall.rule" label="" topic="The proof rule" />
            </h2>
            {rule ? (
              <>
                <p className="rd-lead">{rule.explanation.plain}</p>
                {rule.steps.length > 0 && (
                  <ol className="rd-steps">
                    {rule.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                )}
                <dl className="rd-fields">
                  <div className="rd-field">
                    <dt>First</dt>
                    <dd>
                      {rule.actions.length ? (
                        rule.actions.map((a) => (
                          <span key={a} className="chip" title={ACTION_WHY[a]}>
                            {actionLabel(a, rule)}
                          </span>
                        ))
                      ) : (
                        <span>Nothing to cut or mark</span>
                      )}
                    </dd>
                    <dd className="rd-conf tabular" data-low={low(rule.confidence.actions) ? "" : undefined} aria-label={`Confidence ${percent(rule.confidence.actions)}`}>
                      {percent(rule.confidence.actions)}
                    </dd>
                  </div>
                  <div className="rd-field">
                    <dt>The photo shows</dt>
                    <dd>
                      {rule.photo_required ? (
                        <>
                          {rule.must_show.includes("whole_product") && <span className="chip">The whole product</span>}
                          {rule.must_show.includes("cut_or_damage") && <span className="chip">The cut or damage</span>}
                          {rule.must_show.includes("marking") && <span className="chip">{markerWord(rule)} written on it</span>}
                          {rule.must_show.map((s) => showLabel(s)).filter(Boolean).map((l) => (
                            <span key={l} className="chip">
                              {l}
                            </span>
                          ))}
                        </>
                      ) : (
                        <span>No photo needed</span>
                      )}
                    </dd>
                    <dd className="rd-conf tabular" data-low={low(rule.confidence.must_show) ? "" : undefined} aria-label={`Confidence ${percent(rule.confidence.must_show)}`}>
                      {percent(rule.confidence.must_show)}
                    </dd>
                  </div>
                  <div className="rd-field">
                    <dt>You get</dt>
                    <dd>
                      <span className="chip">{rule.refund_amount ? `A $${rule.refund_amount} refund` : remedyLabel(rule.remedy)}</span>
                      {rule.refund_amount_text && <span className="muted"> &ldquo;{rule.refund_amount_text}&rdquo;</span>}
                    </dd>
                    <dd className="rd-conf tabular" data-low={low(rule.confidence.remedy) ? "" : undefined} aria-label={`Confidence ${percent(rule.confidence.remedy)}`}>
                      {percent(rule.confidence.remedy)}
                    </dd>
                  </div>
                  <div className="rd-field">
                    <dt>Sent by</dt>
                    <dd>{{ email: "Email", web_form: "The firm's web form", phone: "Phone", mail: "Mail", other: "As the firm asks" }[rule.contact_channel]}</dd>
                    <dd className="rd-conf" />
                  </div>
                </dl>
                <p className="rd-note">
                  The percent beside each line is how sure the reader is of it. On Remedy the photo goes to Remedy instead, and is checked against this rule in seconds.
                </p>
                <p className="rd-note lp-tech">
                  {rule.explanation.technical} Source: {rule.source === "selfcheck" ? "Claude draft, then self-check" : rule.source}, {rule.model}, extracted {fmtDate(rule.extracted_at.slice(0, 10))}.
                </p>
              </>
            ) : (
              <p className="rd-missing">This recall&rsquo;s remedy has not been read into a checklist yet. Its official remedy is below.</p>
            )}
          </section>

          <section className="rd-sheet" data-ui aria-labelledby="remedy-h">
            <h2 id="remedy-h">
              The official remedy <Info id="recall.remedy" label="" topic="The official remedy" />
            </h2>
            <blockquote className="rd-quote" cite={d.cpsc_url}>
              {d.remedy_text || "The CPSC record gives no remedy text."}
            </blockquote>
            <p className="rd-quote-src">Word for word from the CPSC record.</p>
            {d.consumer_contact && (
              <>
                <h3 className="rd-sub">How to reach the firm</h3>
                <p className="rd-text">{d.consumer_contact}</p>
              </>
            )}
          </section>
        </div>

        <div>
          <section className="rd-sheet" data-ui aria-labelledby="img-h">
            <h2 id="img-h">
              Official images <Info id="recall.images" label="" topic="Official images" />
            </h2>
            {d.images.length ? (
              <div className="rd-imgs">
                {d.images.slice(0, 6).map((img) => (
                  <figure key={img.url}>
                    <img src={img.thumb ?? img.url} alt={img.caption || `Recall ${d.number} image`} width={img.width ?? 320} height={img.height ?? 320} loading="lazy" />
                    <figcaption>{img.caption}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="rd-text">The CPSC published no images with this recall.</p>
            )}
            <p className="rd-note">Images: U.S. Consumer Product Safety Commission.</p>
          </section>

          <section className="rd-sheet" data-ui aria-labelledby="prod-h">
            <h2 id="prod-h">The product</h2>
            <dl className="rd-kv">
              {products.slice(0, 4).map((p, i) => (
                <div key={`${p.name}-${i}`}>
                  <dt>{products.length > 1 ? `Product ${i + 1}` : "Product"}</dt>
                  <dd>
                    {p.name}
                    {p.model && <span className="muted"> Model {p.model.slice(0, 160)}</span>}
                  </dd>
                </div>
              ))}
              {d.firms.length > 0 && (
                <div>
                  <dt>Firm</dt>
                  <dd>{d.firms.map((f) => f.name).join(", ")}</dd>
                </div>
              )}
              {d.retailers.length > 0 && (
                <div>
                  <dt>Sold at</dt>
                  <dd>{d.retailers.slice(0, 4).join("; ")}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      </div>

      <section className="rd-sheet rd-tech lp-tech" data-ui aria-labelledby="tech-h">
        <h2 id="tech-h">
          Behind this rule <Info id="recall.technical" label="" topic="Behind this rule" />
        </h2>
        {trace ? (
          <>
            <p className="rd-text">
              Claude&rsquo;s first draft came from the Message Batches API ({trace.draft?.batch_id ?? "no batch"}); a self-check pass then reviewed it against the remedy text and a deterministic lint ({trace.checked?.batch_id ?? "no batch"}).
            </p>
            <p className="rd-changed">
              {trace.changed.length ? <>The self-check changed: {trace.changed.join(", ")}.</> : <>The self-check kept every field of the draft.</>}
              {trace.draft?.usage && trace.checked?.usage && (
                <span className="tabular">
                  {" "}
                  Tokens: draft {fmtInt(trace.draft.usage.input_tokens)} in, {fmtInt(trace.draft.usage.output_tokens)} out; check {fmtInt(trace.checked.usage.input_tokens)} in, {fmtInt(trace.checked.usage.output_tokens)} out.
                </span>
              )}
            </p>
            <details>
              <summary>The draft and the checked rule (JSON)</summary>
              <pre tabIndex={0}>{JSON.stringify({ draft: trace.draft?.rule, checked: trace.checked?.rule }, null, 2)}</pre>
            </details>
          </>
        ) : (
          <p className="rd-text">No extraction trace is stored for this recall.</p>
        )}
        {raw && (
          <details>
            <summary>The CPSC Recalls API record (JSON)</summary>
            <pre tabIndex={0}>{JSON.stringify(raw, null, 2)}</pre>
          </details>
        )}
        <p className="rd-note">
          The same data as JSON: <a className="text-link" href={`/api/v1/recalls/${d.number}`}>GET /api/v1/recalls/{d.number}</a>
        </p>
      </section>
    </>
  );
}
