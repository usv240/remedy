import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { FirmInfo } from "@/components/firm/FirmInfo";
import { PrintButton, ReportNarrative } from "@/components/firm/ReportView";
import { dbConfigured } from "@/lib/db";
import { dayName, isMonth, monthName, monthOf, reportMonths } from "@/lib/firm/dates";
import { firmContext } from "@/lib/firm/firm";
import { narrativeFor } from "@/lib/firm/narrative";
import { fmtInt, fmtPct, fmtUsd, formRows } from "@/lib/firm/report";
import { loadReport } from "@/lib/firm/report-data";

export const metadata: Metadata = { title: "CPSC monthly report", description: "Brightline Home's CPSC monthly progress report, counted from its claims and PayPal payments. A fictional sample firm." };

const SOURCES = [
  { label: "CPSC Monthly Progress Report form (updated 10/2015)", href: "https://www.cpsc.gov/s3fs-public/MonthlyProgressReport-ElectronicForm_0.pdf" },
  { label: "CPSC Monthly Progress Report System", href: "https://www.cpsc.gov/Business--Manufacturing/Recall-Guidance/monthly-progress-report-system" },
  { label: "Product Safety Planning, Reporting, and Recall Handbook", href: "https://www.cpsc.gov/s3fs-public/RecallHandbookFINAL9_2technicalrevision_3052025.pdf" },
];

async function Report({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await connection();
  const ctx = dbConfigured() ? await firmContext().catch(() => null) : null;
  if (!ctx?.main) return <p className="firm-sub">The sample firm is not set up on this server yet.</p>;
  const recall = ctx.main;
  const now = new Date();
  const current = monthOf(now);
  const months = reportMonths(recall.announced, 3).filter((m) => m <= current || m === reportMonths(recall.announced, 1)[0]);
  const { month: asked } = await searchParams;
  const month = asked && isMonth(asked) && months.includes(asked) ? asked : months.includes(current) ? current : months.at(-1)!;
  const n = await loadReport(ctx.firm, recall, month, now);
  if (!n) return <p className="firm-sub">No report for that month yet.</p>;
  const narrative = await narrativeFor(ctx.firm, recall, n);
  const rows = formRows(n);
  const sections = [...new Set(rows.map((r) => r.section))];

  return (
    <>
      <form className="firm-form no-print" method="get" action="/firm/reports" style={{ marginTop: 20 }}>
        <label className="firm-field" style={{ maxWidth: "20rem" }}>
          Report month
          <select name="month" defaultValue={month}>
            {months.map((m, i) => (
              <option key={m} value={m}>
                Report {i + 1}: {monthName(m)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-quiet">
          Show
        </button>
        <span className="firm-actions" style={{ marginLeft: "auto" }}>
          <PrintButton />
          <a className="btn btn-quiet" href={`/api/firm/reports?month=${month}&format=csv`} download>
            Download CSV
          </a>
        </span>
      </form>

      <div className="rp-print-only">
        <p>
          <strong>
            {n.firmName} (fictional sample firm). CPSC recall {n.recallNumber}, {n.product}.
          </strong>
        </p>
      </div>

      <h2 className="firm-h2" style={{ marginTop: 24 }}>
        Report {n.period.index}: {dayName(n.period.start)} to {dayName(n.period.end)}
      </h2>
      <p className="muted">
        Due {dayName(n.period.dueOn)}.{n.period.inProgress ? ` The month is still running, so the figures count through ${dayName(n.period.through)}.` : ""} {n.product}, CPSC recall {n.recallNumber}.
      </p>

      <div className="firm-kpis rp-head-figures" role="group" aria-label="This report's main figures">
        <div className="firm-kpi">
          <p className="firm-kpi-label">Corrections this period</p>
          <p className="firm-kpi-value" data-testid="rp-corrections">{fmtInt(n.correctionsThisPeriod)}</p>
          <p className="firm-kpi-sub">units made safe</p>
        </div>
        <div className="firm-kpi">
          <p className="firm-kpi-label">Total corrections</p>
          <p className="firm-kpi-value" data-testid="rp-cumulative">{fmtInt(n.correctionsCumulative)}</p>
          <p className="firm-kpi-sub">since the announcement</p>
        </div>
        <div className="firm-kpi">
          <p className="firm-kpi-label">Refunds paid</p>
          <p className="firm-kpi-value" data-testid="rp-refunds">{fmtInt(n.refundsPaidCount)}</p>
          <p className="firm-kpi-sub">{fmtUsd(n.refundsPaidCents)} through PayPal</p>
        </div>
        <div className="firm-kpi">
          <p className="firm-kpi-label">Waiting to be accepted</p>
          <p className="firm-kpi-value">{fmtInt(n.unclaimedCount)}</p>
          <p className="firm-kpi-sub">{fmtUsd(n.unclaimedCents)}</p>
        </div>
        <div className="firm-kpi">
          <p className="firm-kpi-label">
            Completion <FirmInfo id="firm.completion" label="" />
          </p>
          <p className="firm-kpi-value" data-testid="rp-completion">{fmtPct(n.completionPercent)}</p>
          <p className="firm-kpi-sub">of {n.unitsAffected === null ? n.unitsText : fmtInt(n.unitsAffected)} units</p>
        </div>
      </div>

      <ReportNarrative month={month} recall={recall.number} initial={narrative} />

      <section className="firm-section" aria-labelledby="rp-form">
        <h2 id="rp-form">The CPSC form, filled in</h2>
        <p className="muted">Copy these into the CPSC&rsquo;s Monthly Progress Report System. Field names follow the CPSC&rsquo;s form.</p>
        {sections.map((s) => (
          <table key={s} className="rp-form" data-testid="rp-table">
            <caption>{s === "Remedy" ? "Refunds and claims (from Remedy, beyond the form)" : s}</caption>
            <tbody>
              {rows
                .filter((r) => r.section === s)
                .map((r) => (
                  <tr key={r.field}>
                    <th scope="row">{r.field}</th>
                    <td>
                      {r.value}
                      <span className="tech">{r.source}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ))}
        <p className="tech" style={{ marginTop: 12 }}>
          Counted in SQL from claim, payment and notice for firm {ctx.firm.id}, recall {n.recallNumber}, {n.period.start} 00:00 UTC up to {n.period.through} 24:00 UTC. Includes {fmtInt(n.claimsReceivedSample)} sample claims.
        </p>
      </section>

      <section className="firm-section" aria-labelledby="rp-src">
        <h2 id="rp-src">Sources</h2>
        <ul className="firm-list" style={{ maxWidth: "44rem" }}>
          {SOURCES.map((s) => (
            <li key={s.href}>
              <a className="firm-link" href={s.href} rel="noreferrer" target="_blank">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="firm-label">
          {n.claimsReceivedSample > 0 ? `${fmtInt(n.claimsReceivedSample)} of this period's ${fmtInt(n.claimsReceived)} claims are sample history. ` : ""}Brightline Home is a fictional sample firm, so this report is a demonstration and is not filed with the CPSC. Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm.
        </p>
      </section>
    </>
  );
}

export default function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  return (
    <>
      <header className="firm-head">
        <div>
          <div className="title-row">
            <h1 className="firm-title">CPSC monthly report</h1>
            <FirmInfo id="firm.report" />
          </div>
          <p className="firm-sub">The monthly progress report the CPSC asks for, counted from this recall&rsquo;s claims and PayPal payments.</p>
        </div>
      </header>
      <Suspense fallback={<p className="firm-sub page-loading">Counting the report&hellip;</p>}>
        <Report searchParams={searchParams} />
      </Suspense>
    </>
  );
}
