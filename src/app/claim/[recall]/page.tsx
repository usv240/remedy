import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getRecall, publicRecall } from "@/app/api/claims/_lib/recall";
import { isRecallNumber } from "@/app/api/claims/_lib/recall-text";
import { SAMPLE_FIRM, SHOP_RECALL } from "@/app/api/claims/_lib/terms";
import { ClaimFlow } from "@/components/claim/ClaimFlow";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { Example } from "@/components/claim/Example";
import { RecallCard } from "@/components/claim/RecallCard";
import { StepArt } from "@/components/claim/StepArt";
import { markerWord, ownerSteps } from "@/components/claim/steps";
import { SANDBOX_LABEL } from "@/lib/payments/deps";
import "../../pages.css";
import "@/components/claim/claim.css";

type Params = { params: Promise<{ recall: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { recall } = await params;
  const r = isRecallNumber(recall) ? getRecall(recall) : null;
  return r
    ? { title: `Claim your refund, recall ${r.number}`, description: `Make the recalled ${r.products[0]?.name ?? "product"} safe, snap one photo, and get your refund through PayPal.` }
    : { title: "Claim a recall refund" };
}

async function Claim({ params }: Params) {
  const { recall } = await params;
  if (!isRecallNumber(recall)) notFound();
  const r = getRecall(recall);
  if (!r) notFound();
  const pr = publicRecall(r);
  const steps = ownerSteps(pr.rule);
  const word = markerWord(pr.rule);
  const action = pr.rule.actions.includes("write_recalled") ? "write" : pr.rule.actions.includes("cut_cord") ? "cut_cord" : pr.rule.actions.includes("cut_in_half") ? "cut_in_half" : steps.find((s) => !["stop", "photo", "send", "dispose"].includes(s.kind))?.kind ?? null;
  const asksPhoto = pr.rule.photo_required;

  return (
    <>
      <nav className="cl-crumbs" aria-label="Breadcrumb" data-ui>
        <Link className="text-link" href="/claim">
          Find your recall
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Recall {pr.number}</span>
      </nav>
      <header className="cl-head">
        <h1 className="cl-title">Get your refund</h1>
        <p className="cl-lede">
          For the recalled {pr.product}. Make it safe, snap one photo, and PayPal pays you.
        </p>
      </header>

      <ol className="cl-steps">
        <li className="cl-step cl-step-recall" data-step="recall">
          <h2 className="cl-step-title" data-n="1">
            Your recall
          </h2>
          <RecallCard recall={pr} />
        </li>

        <li className="cl-step" data-step="safe">
          <h2 className="cl-step-title" data-n="2">
            Make it safe <ClaimInfo k="claim.steps" topic="making it safe" />
          </h2>
          <ol className="cl-todo">
            {steps.map((s) => (
              <li key={s.text} className="cl-todo-item">
                <StepArt kind={s.kind} word={word ?? undefined} />
                <p className="cl-todo-text">
                  {s.text} <ClaimInfo k={s.info} topic={`why: ${s.text}`} />
                </p>
              </li>
            ))}
          </ol>
          {pr.example && <Example example={pr.example} />}
          <div className="cl-tech cl-rule" data-ui>
            <p className="cl-rule-k">Proof rule {pr.ruleSource === "ai" ? `(${pr.ruleModel}, stored)` : "(quick read, keyword rules)"}</p>
            <dl className="cl-rule-dl">
              <div>
                <dt>Actions</dt>
                <dd>{pr.rule.actions.join(", ") || "none"}</dd>
              </div>
              <div>
                <dt>Marker text</dt>
                <dd>{pr.rule.marker_text ?? "none"}</dd>
              </div>
              <div>
                <dt>Photo must show</dt>
                <dd>{pr.rule.must_show.join(", ") || "nothing"}</dd>
              </div>
              <div>
                <dt>Remedy</dt>
                <dd>
                  {pr.rule.remedy}
                  {pr.rule.refund_amount_text ? `, "${pr.rule.refund_amount_text}"` : ""}
                </dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd className="tabular">
                  actions {pr.rule.confidence.actions}, must show {pr.rule.confidence.must_show}, remedy {pr.rule.confidence.remedy}
                </dd>
              </div>
            </dl>
            <p className="cl-hint">{pr.rule.explanation.technical}</p>
          </div>
        </li>

        {asksPhoto ? (
          <ClaimFlow recall={{ number: pr.number, product: pr.product, word, action, example: pr.example, shop: pr.number === SHOP_RECALL }} />
        ) : (
          <li className="cl-step" data-step="photo">
            <h2 className="cl-step-title" data-n="3">
              This recall does not ask for a photo
            </h2>
            <p className="cl-lead">Its remedy is handled by the firm directly. Read what to do on the recall page.</p>
            <p>
              <a className="text-link" href={pr.url} target="_blank" rel="noreferrer">
                Recall {pr.number} on cpsc.gov
              </a>
            </p>
          </li>
        )}
      </ol>

      <p className="page-note cl-note-foot">
        {SANDBOX_LABEL} Refunds here are paid by {SAMPLE_FIRM}, a fictional sample firm, from its PayPal sandbox account. Recall data and images: US Consumer Product Safety Commission.
      </p>
    </>
  );
}

// The recall number is runtime data, so the page reads it inside Suspense; the fallback holds the page's height.
export default function ClaimPage({ params }: Params) {
  return (
    <div className="cl-page frame">
      <Suspense fallback={<p className="page-loading">Loading your recall</p>}>
        <Claim params={params} />
      </Suspense>
    </div>
  );
}
