import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getClaimView, isClaimId } from "@/app/api/claims/_lib/claims";
import { CHECK_ORDER, checkWord, money, seconds, when } from "@/components/claim/format";
import { ReceiptLive } from "@/components/claim/ReceiptLive";
import { db, dbConfigured, schema } from "@/lib/db";
import { payerWords } from "@/lib/recall/label";
import "../../pages.css";
import "@/components/claim/claim.css";

export const metadata: Metadata = { title: "Your refund receipt", description: "Where your recall refund is, live from PayPal, with each check your photo passed.", robots: { index: false } };

const EVENT: Record<string, string> = {
  "claim.submitted": "Photo received",
  "claim.decided": "Checks finished",
  "claim.limit_review": "Sent to the firm: claim limit",
  "claim.paid": "Refund landed",
  "payment.plan_created": "Payment planned",
  "payment.plan_approved": "Approved by the firm",
  "paypal.payout.created": "Payout sent to PayPal",
  "paypal.refund.created": "Refund sent to PayPal",
  "paypal.replacement.ordered": "Replacement ordered",
  "payment.paid": "PayPal confirmed it paid",
  "payment.unclaimed": "Waiting to be accepted",
  "plan.task_added": "Follow-up added to the firm's plan",
};

const ROUTE: Record<string, string> = { payout: "PayPal Payouts", refund: "Refund to the original PayPal capture", replacement: "Safe replacement, Orders v2" };

type Params = { params: Promise<{ claimId: string }> };

async function Receipt({ params }: Params) {
  const { claimId } = await params;
  if (!isClaimId(claimId)) notFound();
  if (!dbConfigured()) return <p className="page-loading">The receipt needs its database. See the README to start it.</p>;
  const c = await getClaimView(claimId);
  if (!c) notFound();
  const events = await db()
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.ref, `claim:${claimId}`))
    .orderBy(asc(schema.auditEvents.id));
  const p = c.payment;

  return (
    <>
      <ReceiptLive initial={c} />

      <div className="rc-body">
        <section className="rc-card app-sheet" aria-labelledby="rc-what" data-ui>
          <h2 id="rc-what" className="rc-h">
            Your claim
          </h2>
          <dl className="rc-facts">
            <div>
              <dt>Product</dt>
              <dd>{c.recall.product}</dd>
            </div>
            <div>
              <dt>Recall</dt>
              <dd>
                <Link className="text-link tabular" href={`/claim/${c.recall.number}`}>
                  {c.recall.number}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Refund</dt>
              <dd className="tabular">{money(p?.amount ?? c.amount?.value) || "Not set"}</dd>
            </div>
            {p?.payee && (
              <div>
                <dt>Sent to</dt>
                <dd className="tabular">{p.payee.type === "venmo" ? `Venmo ${p.payee.masked}` : `PayPal ${p.payee.masked}`}</dd>
              </div>
            )}
            {p?.route === "refund" && (
              <div>
                <dt>Sent to</dt>
                <dd>Your original PayPal payment</dd>
              </div>
            )}
            {p?.replacement && (
              <div>
                <dt>Replacement</dt>
                <dd>
                  {p.replacement.title}, from {p.replacement.retailer}
                </dd>
              </div>
            )}
            <div>
              <dt>Submitted</dt>
              <dd className="tabular">{when(c.created_at)}</dd>
            </div>
            {c.timings && (
              <div>
                <dt>Checked in</dt>
                <dd className="tabular">{seconds(c.timings.total_ms)}</dd>
              </div>
            )}
            <div>
              <dt>Paid by</dt>
              <dd>{payerWords(c.recall.number).short}</dd>
            </div>
          </dl>
          {p && <p className="rc-why">{p.reasons.plain}</p>}
        </section>

        <section className="rc-card app-sheet" aria-labelledby="rc-checks" data-ui>
          <h2 id="rc-checks" className="rc-h">
            The six checks
          </h2>
          <div className="rc-checks-wrap">
            {c.photo_url && (
              // eslint-disable-next-line @next/next/no-img-element -- the owner's own stored photo
              <img className="rc-photo" src={c.photo_url} alt="The photo you sent" width={160} height={160} />
            )}
            <ul className="rc-checks">
              {CHECK_ORDER.map(({ id, name }) => {
                const k = c.checks.find((x) => x.id === id);
                const w = checkWord(k?.status ?? "skipped", { reviewersAgreed: c.decision === "verified" && c.decided_by === "reviewers" });
                return (
                  <li key={id}>
                    <span>{name}</span>
                    <span className="cl-check-word" data-tone={w.tone}>
                      {w.word}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="rc-card app-sheet cl-tech" aria-labelledby="rc-tech" data-ui>
          <h2 id="rc-tech" className="rc-h">
            Technical record
          </h2>
          <dl className="rc-facts">
            <div>
              <dt>Claim</dt>
              <dd className="tabular rc-mono">{c.id}</dd>
            </div>
            <div>
              <dt>Decision</dt>
              <dd>
                {c.decision} ({c.decided_by}){c.model ? `, ${c.model}` : ""}
              </dd>
            </div>
            {p && (
              <>
                <div>
                  <dt>Route</dt>
                  <dd>{ROUTE[p.route] ?? p.route}</dd>
                </div>
                <div>
                  <dt>Plan</dt>
                  <dd>
                    {p.plan_status}
                    {p.approval ? `, approved by ${p.approval.who}${p.approval.rule ? ` (${p.approval.rule})` : ""}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>PayPal status</dt>
                  <dd className="tabular">{p.paypal_status ?? "none yet"}</dd>
                </div>
                {Object.entries(p.ids)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k.replace(/_/g, " ")}</dt>
                      <dd className="tabular rc-mono">{v}</dd>
                    </div>
                  ))}
                <div>
                  <dt>Why this route</dt>
                  <dd>{p.reasons.technical}</dd>
                </div>
              </>
            )}
          </dl>
          {events.length > 0 && (
            <ol className="rc-events">
              {events.map((e) => (
                <li key={e.id}>
                  <span>{EVENT[e.action] ?? e.action}</span>
                  <span className="muted tabular">{when(e.at.toISOString())}</span>
                  <span className="rc-hash tabular" title={e.hash}>
                    {e.hash.slice(0, 12)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="cl-hint">Each line is an entry in Remedy&rsquo;s hash-chained ledger; the code is the first characters of its hash.</p>
        </section>
      </div>

      <p className="page-note">{c.sandbox_label}</p>
      <p className="rc-next">
        <Link className="text-link" href="/try">
          Try another photo
        </Link>
        <Link className="text-link" href="/claim">
          Claim another recall
        </Link>
      </p>
    </>
  );
}

// The claim id is runtime data, so the whole receipt is read inside Suspense.
export default function ReceiptPage({ params }: Params) {
  return (
    <div className="rc-page frame">
      <Suspense fallback={<p className="page-loading">Loading your receipt</p>}>
        <Receipt params={params} />
      </Suspense>
    </div>
  );
}
