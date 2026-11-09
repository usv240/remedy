"use client";

import { useEffect, useRef, useState } from "react";
import { shownCheck } from "@/lib/firm/checks";
import { isSampleNumber, recallLabel } from "@/lib/recall/label";
import { SAMPLE_REVIEWER, STAGE_LABEL, STAGE_TONE, type ClaimDetail } from "@/lib/firm/types";
import { CopyButton } from "@/components/developers/CopyButton";
import { FirmInfo } from "./FirmInfo";
import { Thumb } from "./Thumb";

const usd = (c: number | null | undefined) => (c === null || c === undefined ? "" : `$${(c / 100).toFixed(2)}`);
const ROUTE: Record<string, string> = { refund: "Refund to the original PayPal payment", payout: "PayPal payout", replacement: "Safe replacement" };
const DECISION: Record<string, string> = { verified: "Verified by the checks", retake: "A new photo is needed", firm_review: "Sent to the firm for review", pending: "Still checking" };

type Busy = "idle" | "loading" | "paying" | "retake";

function summary(d: ClaimDetail): string {
  const r = d.row;
  if (r.stage === "paid") return `Paid ${usd(r.amountCents)}${r.payout.sample ? " (sample history, no money moved)" : ""}.`;
  if (r.stage === "unclaimed") return "The payout was sent and is waiting for the owner to accept it. A friendly reminder is in the plan.";
  if (r.stage === "sending") return "PayPal is sending the payout now.";
  if (r.stage === "ready") return `All checks are done. Ready to pay ${usd(r.amountCents)}.`;
  if (r.stage === "retake") return "A new photo was asked for. The owner uses the same link to send it.";
  if (r.stage === "needs_review") {
    if (r.payout.status === "failed" || r.payout.status === "blocked") return "PayPal could not send this payment. Check the contact, then try again.";
    const unsure = d.checks.filter((c) => c.status === "unclear" || c.status === "fail").map((c) => c.name.toLowerCase());
    return unsure.length ? `The checks could not confirm: ${unsure.join(", ")}. A person at the firm decides.` : "A person at the firm decides this one.";
  }
  return DECISION[r.decision] ?? "";
}

/**
 * `reviewer` is null until the person signs in as the sample reviewer; approving and retakes wait for that, and the
 * drawer offers the same one-click sign-in (`onSignIn`) so nobody has to close it first.
 */
export function ClaimDrawer({
  claimId,
  stamp,
  reviewer,
  onSignIn,
  onClose,
  onChanged,
}: {
  claimId: string | null;
  stamp: string;
  reviewer: string | null;
  onSignIn?: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [status, setStatus] = useState<{ text: string; tone?: "attention" | "positive" } | null>(null);
  const [retakeOpen, setRetakeOpen] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ text: string; to: string; channel: string } | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (claimId && !d.open) d.showModal();
    if (!claimId && d.open) d.close();
  }, [claimId]);

  useEffect(() => {
    if (!claimId) return;
    let live = true;
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy((b) => (b === "idle" ? "loading" : b));
    fetch(`/api/firm/claims/${claimId}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { data: ClaimDetail | null; error: { message: string } | null }) => {
        if (!live) return;
        if (j.data) setDetail(j.data);
        else setStatus({ text: j.error?.message ?? "This claim could not be loaded.", tone: "attention" });
      })
      .catch(() => live && setStatus({ text: "This claim could not be loaded. Please try again.", tone: "attention" }))
      .finally(() => live && setBusy((b) => (b === "loading" ? "idle" : b)));
    return () => {
      live = false;
      ctl.abort();
    };
  }, [claimId, stamp]);

  useEffect(() => {
    // A new claim starts clean.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(null);
    setRetakeOpen(false);
    setNote("");
    setMessage(null);
    if (!claimId) setDetail(null);
  }, [claimId]);

  async function pay() {
    if (!detail) return;
    setBusy("paying");
    setStatus({ text: "Approving and sending the payout through PayPal…" });
    try {
      const r = await fetch("/api/firm/claims/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claim_ids: [detail.row.id], reviewer, reviewed: true }) });
      const j = (await r.json()) as { data: { results: { ok: boolean; plain: string; kind: string; batchId: string | null }[] } | null; error: { message: string } | null };
      const res = j.data?.results[0];
      if (!res) setStatus({ text: j.error?.message ?? "The payment could not be started.", tone: "attention" });
      else setStatus({ text: res.ok ? `${res.plain}${res.batchId ? ` PayPal batch ${res.batchId}.` : ""}` : res.plain, tone: res.ok ? "positive" : "attention" });
      onChanged();
    } catch {
      setStatus({ text: "The payment could not be started. Please try again.", tone: "attention" });
    } finally {
      setBusy("idle");
    }
  }

  async function retake() {
    if (!detail) return;
    setBusy("retake");
    try {
      const r = await fetch(`/api/firm/claims/${detail.row.id}/retake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewer, note }) });
      const j = (await r.json()) as { data: { message: string; to: string; channel: string } | null; error: { message: string } | null };
      if (j.data) {
        setMessage({ text: j.data.message, to: j.data.to, channel: j.data.channel });
        setStatus({ text: `Saved. The message to ${j.data.to} is below, to send from your own mail tool; Remedy sends no mail.`, tone: "positive" });
        setRetakeOpen(false);
        onChanged();
      } else setStatus({ text: j.error?.message ?? "The request could not be saved.", tone: "attention" });
    } catch {
      setStatus({ text: "The request could not be saved. Please try again.", tone: "attention" });
    } finally {
      setBusy("idle");
    }
  }

  const r = detail?.row;
  const canPay = Boolean(r && !r.payout.status && (r.stage === "ready" || (r.stage === "needs_review" && r.decision === "firm_review")) && (r.amountCents ?? 0) > 0 && detail?.plan.route);
  const canRetake = Boolean(r && (!r.payout.status || r.payout.status === "failed") && r.stage !== "retake" && r.stage !== "declined");

  return (
    <dialog ref={dialog} className="cq-drawer" aria-labelledby="cq-drawer-title" onClose={onClose} onCancel={() => onClose()}>
      <div className="cq-drawer-inner">
        <div className="cq-drawer-head">
          <h2 className="cq-drawer-title" id="cq-drawer-title">
            {r ? (r.payeeType ? `Claim from ${r.claimant}` : "Claim with no contact yet") : "Claim"}
          </h2>
          <button type="button" className="cq-close" onClick={onClose} aria-label="Close the claim">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="cq-drawer-body">
          {!detail || !r ? (
            <p className="muted">{busy === "loading" ? "Loading the claim…" : (status?.text ?? "")}</p>
          ) : (
            <>
              {r.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="cq-photo" src={r.photoUrl} alt={`The photo ${r.claimant} sent`} />
              ) : (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Thumb url={null} made={r.checks.C2 === "pass"} size={64} label="Claim photo" />
                  <p className="muted">
                    {r.photoRemoved === "person"
                      ? "The photo showed a person, so it was deleted at once. Its fingerprint is kept."
                      : r.photoRemoved === "retention"
                        ? "The photo was deleted 90 days after the decision, as Remedy keeps photos. Its fingerprint is kept."
                        : "Sample claim: no photo is stored, so a drawing stands in."}
                  </p>
                </div>
              )}
              {detail.note && <p className="cq-photo-credit">{detail.note}</p>}

              <div className="cq-result" aria-live="polite">
                <p className="cq-result-head">
                  <span className="pill" data-tone={STAGE_TONE[r.stage]}>
                    {STAGE_LABEL[r.stage]}
                  </span>
                  <span>{DECISION[r.decision]}</span>
                </p>
                <p style={{ marginTop: 6 }}>{summary(detail)}</p>
                {detail.verdict?.summary?.plain && detail.verdict.summary.plain !== summary(detail) && <p className="muted" style={{ marginTop: 4 }}>The checks said: {detail.verdict.summary.plain}</p>}
                {r.confidence !== null && <p className="muted tabular">Confidence {r.confidence.toFixed(2)}</p>}
                {detail.verdict && (
                  <p className="tech">
                    Decided by {detail.verdict.decidedBy ?? "the checks"}
                    {detail.verdict.model ? `, ${detail.verdict.model}` : ""}
                    {detail.verdict.totalMs !== null ? `, ${(detail.verdict.totalMs / 1000).toFixed(1)} s` : ""}
                    {detail.verdict.quality && !detail.verdict.quality.ok ? `, photo quality: ${detail.verdict.quality.issues.join(", ")}` : ""}.
                  </p>
                )}
              </div>

              {detail.verdict?.guidance && (r.decision === "retake" || r.stage === "retake") && (
                <section className="cq-block" aria-labelledby="cq-help">
                  <h3 id="cq-help">What would help the owner</h3>
                  <p>{detail.verdict.guidance.plain}</p>
                  {detail.verdict.guidance.steps.length > 0 && (
                    <ul className="cq-steps" style={{ listStyle: "disc" }}>
                      {detail.verdict.guidance.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section className="cq-block" aria-labelledby="cq-checks">
                <h3 id="cq-checks">
                  The checks <FirmInfo id="firm.checks" label="" />
                </h3>
                <ul className="cq-check-list">
                  {detail.checks.map((c) => {
                    // An unsure check the two reviewers settled reads as confirmed; the photo check's own reading and
                    // score stay one switch away, in the Technical view.
                    const w = shownCheck(c.id, c.status, r.reviewers);
                    return (
                      <li key={c.id}>
                        <span className="cq-check" data-tone={w.tone} data-settled={w.settled ? "" : undefined}>
                          {w.word}
                        </span>
                        <span>
                          <span className="cq-check-name">{c.name}.</span> {w.settled ? "The two reviewers looked closer and confirmed it, each citing what it saw in the photo." : c.plain}
                          {(c.technical || w.settled) && (
                            <span className="tech">
                              {" "}
                              {c.id}
                              {c.score !== null ? `, score ${c.score.toFixed(2)}` : ""}
                              {w.settled ? `, under the pass mark, so the two reviewers looked; the photo check said: ${c.plain}` : ""}
                              {c.technical ? `: ${c.technical}` : ""}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {detail.review && (
                <section className="cq-block" aria-labelledby="cq-review">
                  <h3 id="cq-review">
                    Two reviewers <FirmInfo id="firm.two-reviewers" label="" />
                  </h3>
                  <p>
                    <strong>Referee: {detail.review.referee.agreed ? "the reviewers agree" : "the reviewers disagree"}.</strong>{" "}
                    {typeof detail.review.referee.summary === "string" ? detail.review.referee.summary : detail.review.referee.summary.plain}
                  </p>
                  {typeof detail.review.referee.summary !== "string" && <p className="tech">{detail.review.referee.summary.technical}</p>}
                  {detail.review.reviews.map((v) => (
                    <div key={v.reviewer} className="cq-reviewer">
                      <p className="cq-reviewer-head">
                        <span>
                          {v.name}: {v.answer}
                        </span>
                        <span className="tabular muted">{v.confidence.toFixed(2)}</span>
                      </p>
                      <p className="muted">{v.reads}</p>
                      <p>{v.reason.plain}</p>
                      <p className="tech">
                        {v.reason.technical}
                        {v.counted ? "" : ` Set aside: ${v.set_aside_reason ?? "not counted"}.`}
                      </p>
                    </div>
                  ))}
                  {detail.review.model && <p className="tech">Model {detail.review.model}{detail.review.ms ? `, ${detail.review.ms} ms` : ""}.</p>}
                </section>
              )}

              {detail.rule && (
                <section className="cq-block" aria-labelledby="cq-rule">
                  <h3 id="cq-rule">What the recall asks</h3>
                  {detail.rule.steps.length ? (
                    <ol className="cq-steps">
                      {detail.rule.steps.slice(0, 4).map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>{detail.rule.plain}</p>
                  )}
                  <p className="tech">
                    Proof rule ({detail.rule.source ?? "ai"}): actions {detail.rule.actions.join(", ") || "none"}; the photo must show {detail.rule.mustShow.join(", ") || "the product"}.
                  </p>
                </section>
              )}

              <section className="cq-block" aria-labelledby="cq-plan">
                <h3 id="cq-plan">
                  Payment plan <FirmInfo id="firm.plan-route" label="" />
                </h3>
                <dl className="cq-kv">
                  <dt>How</dt>
                  <dd>{detail.plan.route ? ROUTE[detail.plan.route] : "No route yet"}</dd>
                  <dt>Amount</dt>
                  <dd className="tabular">{usd(detail.plan.amountCents) || "None set"}</dd>
                  <dt>To</dt>
                  <dd>{detail.plan.payee ?? "No contact yet"}</dd>
                  <dt>Approval</dt>
                  <dd>{detail.plan.approval ?? (r.decision === "firm_review" ? "A person at the firm" : "The firm's auto rule, or you")}</dd>
                  {detail.payment && (
                    <>
                      <dt>Payment</dt>
                      <dd>
                        {detail.payment.plain}
                        {detail.payment.sample ? " Sample history, not paid." : ""}
                      </dd>
                    </>
                  )}
                </dl>
                <p style={{ marginTop: 8 }}>{detail.plan.plain}</p>
                <p className="tech">
                  {detail.plan.technical}
                  {detail.payment?.batchId ? ` Payout batch ${detail.payment.batchId}.` : ""}
                  {detail.payment?.itemId ? ` Item ${detail.payment.itemId}.` : ""}
                  {detail.payment?.paypalStatus ? ` PayPal status ${detail.payment.paypalStatus}.` : ""}
                  {detail.payment?.issue ? ` Issue ${detail.payment.issue}.` : ""}
                </p>
              </section>

              {message && (
                <section className="cq-block" aria-labelledby="cq-msg">
                  <h3 id="cq-msg">
                    Message to {message.to} ({message.channel === "sms" ? "text" : "email"})
                  </h3>
                  <p className="cq-message">{message.text}</p>
                  <p>
                    <CopyButton text={message.text} label="Copy the message" />
                  </p>
                </section>
              )}

              <p className="cq-note">
                {detail.recall.title} ({recallLabel(detail.recall.number)}). Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm.
              </p>
            </>
          )}
        </div>

        {r && (canPay || canRetake || status) && (
          <div className="cq-drawer-foot">
            {retakeOpen ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void retake();
                }}
                style={{ display: "grid", gap: 8 }}
              >
                <label className="firm-field">
                  A short note for the owner (optional)
                  <textarea value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="For example: please show the label with the model number." />
                </label>
                <div className="firm-actions">
                  <button type="submit" className="btn btn-ink" disabled={busy !== "idle"}>
                    {busy === "retake" ? "Saving…" : "Send the request"}
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setRetakeOpen(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="firm-actions">
                {(canPay || canRetake) && !reviewer && onSignIn && (
                  <button type="button" className="btn btn-quiet" onClick={onSignIn} data-testid="drawer-sign-in">
                    Sign in as {SAMPLE_REVIEWER} (sample reviewer)
                  </button>
                )}
                {canPay && (
                  <button type="button" className="btn btn-primary" onClick={() => void pay()} disabled={busy !== "idle" || !reviewer} title={reviewer ? undefined : "Sign in as the sample reviewer first"}>
                    {busy === "paying" ? "Sending…" : `Approve and pay ${usd(r.amountCents)}`}
                  </button>
                )}
                {canRetake && (
                  <button type="button" className="btn btn-quiet" onClick={() => setRetakeOpen(true)} disabled={busy !== "idle" || !reviewer} title={reviewer ? undefined : "Sign in as the sample reviewer first"}>
                    Ask for a retake
                  </button>
                )}
              </div>
            )}
            <p className="firm-status" role="status" data-tone={status?.tone}>
              {status?.text ??
                ((canPay || canRetake) && !reviewer
                  ? "Approving and asking for a new photo are done in a reviewer's name: sign in as the sample reviewer first."
                  : canPay && detail
                    ? `${isSampleNumber(detail.recall.number) ? "Pays from Brightline Home's PayPal sandbox account" : "Pays from Remedy's PayPal sandbox account in this demo (in a real deployment, the recalling firm's own)"}, approved by ${reviewer}.`
                    : "")}
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
}
