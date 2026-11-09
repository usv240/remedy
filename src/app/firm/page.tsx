import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Info } from "@/components/Info";
import { FirmInfo } from "@/components/firm/FirmInfo";
import { PaypalConnect } from "@/components/firm/PaypalConnect";
import { autoPaidToday } from "@/app/api/claims/_lib/claims";
import { firmTerms } from "@/app/api/claims/_lib/terms";
import { limitRules } from "@/lib/firm/limits";
import { accountView } from "@/lib/paypal/firm-account";
import { dbConfigured } from "@/lib/db";
import { dayName, monthName, whenWords } from "@/lib/firm/dates";
import { firmContext } from "@/lib/firm/firm";
import { homeSummary } from "@/lib/firm/home";
import { ensureReadyClaims } from "@/lib/firm/sample-claims";
import { fmtInt, fmtPct, fmtUsd } from "@/lib/firm/report";
import { isSampleNumber, recallCredit, RecallLabel } from "@/lib/recall/label";

/** "4 days ago" reads in lower case after a comma; a date keeps its capital month ("Oct 20, 2026"). */
const sinceWords = (w: string) => (/^[A-Z][a-z]{2} \d/.test(w) ? w : w.toLowerCase());

export const metadata: Metadata = { title: "Firm console", description: "Brightline Home's recall console: claims to review, the recall plan and the monthly report. A fictional sample firm." };

async function Home() {
  await connection();
  const ctx = dbConfigured() ? await firmContext().catch(() => null) : null;
  if (!ctx?.main) {
    return <p className="firm-sub">The sample firm is not set up on this server yet. Run scripts/seed.ts, then scripts/seed-firm.ts.</p>;
  }
  await ensureReadyClaims(ctx.firm.id, ctx.main.number).catch(() => 0);
  const s = await homeSummary(ctx.firm, ctx.main, ctx.recalls.slice(1));
  const [terms, account, paidToday] = await Promise.all([firmTerms(ctx.main.number), accountView(ctx.firm.id), autoPaidToday(ctx.firm.id, ctx.main.number).catch(() => 0)]);
  const rules = limitRules(terms);
  const now = new Date();
  return (
    <>
      <div className="firm-recall">
        {s.recall.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.recall.image} alt={isSampleNumber(s.recall.number) ? `${s.recall.short}, the sample product` : `${s.recall.short}, official CPSC photo`} width={96} height={96} />
        ) : (
          <span aria-hidden="true" />
        )}
        <div>
          <p className="firm-recall-title">{s.recall.short}</p>
          <p className="firm-recall-meta">
            {RecallLabel(s.recall.number)}, announced {dayName(s.recall.announced)}. {s.recall.units ? `${fmtInt(s.recall.units)} units` : s.recall.unitsText} in the US.{" "}
            <Info id={isSampleNumber(s.recall.number) ? "recall.images.sample" : "recall.images"} label="" topic={isSampleNumber(s.recall.number) ? "the recall's photos" : "the official CPSC photo"} />
          </p>
          <p className="firm-recall-meta">{recallCredit(s.recall.number)}</p>
        </div>
      </div>

      <div className="firm-kpis" role="group" aria-label={`${s.recall.short} recall progress`}>
        <div className="firm-kpi">
          <p className="firm-kpi-label">Claims verified</p>
          <p className="firm-kpi-value">{fmtInt(s.claimsVerified)}</p>
          <p className="firm-kpi-sub">
            of {fmtInt(s.claimsTotal)} received on this recall; {fmtInt(s.claimsAllRecalls.claims)} in the queue across {fmtInt(s.claimsAllRecalls.recalls)} {s.claimsAllRecalls.recalls === 1 ? "recall" : "recalls"}
          </p>
        </div>
        <div className="firm-kpi">
          <p className="firm-kpi-label">Units corrected</p>
          <p className="firm-kpi-value">{fmtInt(s.unitsCorrected)}</p>
          <p className="firm-kpi-sub">made safe and checked</p>
        </div>
        <div className="firm-kpi">
          <p className="firm-kpi-label">Refunds paid</p>
          <p className="firm-kpi-value">{fmtInt(s.refundsPaid.count)}</p>
          <p className="firm-kpi-sub">{fmtUsd(s.refundsPaid.cents)} through PayPal</p>
        </div>
        <div className="firm-kpi">
          <p className="firm-kpi-label">
            Completion <FirmInfo id="firm.completion" label="" />
          </p>
          <p className="firm-kpi-value">{fmtPct(s.completionPercent)}</p>
          <div className="firm-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, s.completionPercent)}%` }} />
          </div>
        </div>
        <div className="firm-kpi">
          <p className="firm-kpi-label">Since announcement</p>
          <p className="firm-kpi-value">{fmtInt(s.recall.daysSince)}</p>
          <p className="firm-kpi-sub">{s.recall.daysSince === 1 ? "day" : "days"}</p>
        </div>
      </div>

      <div className="firm-tiles">
        <section className="firm-tile" aria-labelledby="t-review">
          <h2 className="firm-tile-head" id="t-review">
            Needs review <FirmInfo id="firm.needs-review" label="" />
          </h2>
          <p className="firm-tile-value">{fmtInt(s.needsReview)}</p>
          <p className="muted">{s.needsReview === 0 ? "Nothing is waiting for a person." : `${s.needsReview === 1 ? "claim waits" : "claims wait"} for a person at the firm.`}</p>
          {s.readyToPay > 0 && (
            <p>
              {fmtInt(s.readyToPay)} verified {s.readyToPay === 1 ? "claim is" : "claims are"} ready to pay.
            </p>
          )}
          <p className="firm-tile-foot">
            <Link className="firm-link" href="/firm/claims?view=review">
              Open the claims queue
            </Link>
          </p>
        </section>

        <section className="firm-tile" aria-labelledby="t-report">
          <h2 className="firm-tile-head" id="t-report">
            Next CPSC report <FirmInfo id="firm.next-report" label="" />
          </h2>
          {s.nextReport ? (
            <>
              <p className="firm-tile-value">{dayName(s.nextReport.dueOn)}</p>
              <p className="muted">
                Report {s.nextReport.index}, {monthName(s.nextReport.month)}. Due in {fmtInt(s.nextReport.daysLeft)} {s.nextReport.daysLeft === 1 ? "day" : "days"}.
              </p>
            </>
          ) : (
            <p className="muted">No report is due yet.</p>
          )}
          <p className="firm-tile-foot">
            <Link className="firm-link" href={`/firm/reports${s.nextReport ? `?month=${s.nextReport.month}` : ""}`}>
              Prepare the report
            </Link>
          </p>
        </section>

        <section className="firm-tile" aria-labelledby="t-unclaimed">
          <h2 className="firm-tile-head" id="t-unclaimed">
            Waiting to be accepted <FirmInfo id="firm.unclaimed" label="" />
          </h2>
          <p className="firm-tile-value">{fmtInt(s.unclaimedCount)}</p>
          {s.unclaimedCount === 0 ? (
            <p className="muted">Every payout sent has been accepted.</p>
          ) : (
            <ul className="firm-list">
              {s.unclaimed.map((u) => (
                <li key={u.claimId}>
                  <span>
                    {u.claimant}
                    {u.sample ? <span className="muted"> (sample)</span> : null}
                  </span>
                  <span className="tabular muted">
                    {fmtUsd(u.amountCents)}, {sinceWords(whenWords(u.since, now))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {s.unclaimedCount > s.unclaimed.length && (
            <p className="muted tabular">
              The oldest {fmtInt(s.unclaimed.length)} of {fmtInt(s.unclaimedCount)}.{" "}
              <Link className="text-link" href="/firm/claims?view=unclaimed">
                See all {fmtInt(s.unclaimedCount)}
              </Link>
            </p>
          )}
          <p className="firm-tile-foot">
            <Link className="firm-link" href="/firm/plan">
              See the reminders in the plan
            </Link>
          </p>
        </section>
      </div>

      <section className="firm-section firm-pay" aria-labelledby="t-pay">
        <h2 id="t-pay">Payments and claim limits</h2>
        <div className="firm-pay-grid">
          <div className="firm-tile">
            <h3 className="firm-tile-head">PayPal account</h3>
            <PaypalConnect initial={account} sample={ctx.firm.isSample} />
          </div>
          <div className="firm-tile">
            <h3 className="firm-tile-head">Claim limits</h3>
            <ul className="firm-rules">
              {rules.map((r) => (
                <li key={r.title}>
                  <p className="firm-rule-title">{r.title}</p>
                  <p className="muted">{r.rule}</p>
                </li>
              ))}
            </ul>
            <p className="tabular firm-kpi-sub">
              Auto-paid today on {s.recall.short}: {fmtUsd(paidToday)} of {fmtUsd(terms.autoDailyCents)}.
            </p>
          </div>
        </div>
      </section>

      {s.otherRecalls.length > 0 && (
        <section className="firm-section" aria-labelledby="t-other">
          <h2 id="t-other">Other recalls in this console</h2>
          <ul className="firm-list" style={{ maxWidth: "36rem" }}>
            {s.otherRecalls.map((r) => (
              <li key={r.number}>
                <span>
                  {r.short} <span className="muted">({isSampleNumber(r.number) ? `sample ${r.number}` : `CPSC ${r.number}`})</span>
                </span>
                <span className="tabular muted">
                  {fmtInt(r.claims)} {r.claims === 1 ? "claim" : "claims"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="firm-label">
        {s.sampleClaims > 0 ? `${fmtInt(s.sampleClaims)} of these claims are sample history, seeded so the console is not empty; their payments are marked sample and no money moved. ` : ""}
        Sample history uses the firm&rsquo;s refund for each recall; the sample claims ready to pay are at the recall&rsquo;s refund of $34.99, and two more are added when they have been paid. Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm.
      </p>
    </>
  );
}

export default function FirmPage() {
  return (
    <>
      <header className="firm-head">
        <div>
          <div className="title-row">
            <h1 className="firm-title">Brightline Home</h1>
            <Info id="page.firm" />
          </div>
          <p className="firm-sub">The recall console: claims to review, the recall plan and the monthly CPSC report. A fictional sample firm.</p>
          <p className="firm-sub firm-open">
            This console is open to everyone, by design, so the sample firm can be seen end to end; approving a payout takes one click to sign in as Ana, the sample reviewer. A firm&rsquo;s own deployment runs on its own PayPal app and signs in through
            PayPal&rsquo;s Partner Referrals onboarding, as{" "}
            <Link className="text-link" href="/stack#onboarding">
              the stack page
            </Link>{" "}
            describes.
          </p>
        </div>
      </header>
      <Suspense fallback={<p className="firm-sub page-loading">Loading the recall&hellip;</p>}>
        <Home />
      </Suspense>
    </>
  );
}
