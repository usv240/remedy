import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { FirmInfo } from "@/components/firm/FirmInfo";
import { PlanLoader } from "@/components/firm/PlanLoader";
import { dbConfigured } from "@/lib/db";
import { isoDay } from "@/lib/firm/dates";
import { firmContext } from "@/lib/firm/firm";
import { toGantt } from "@/lib/firm/plan";
import { ensureBasePlan, planRows, reviewSchedule } from "@/lib/firm/plan-data";
import { recallLabel } from "@/lib/recall/label";

export const metadata: Metadata = { title: "Recall plan", description: "Brightline Home's corrective-action plan: notices, payout batches, follow-ups and CPSC reports, updated live from PayPal. A fictional sample firm." };

async function Plan() {
  await connection();
  const ctx = dbConfigured() ? await firmContext().catch(() => null) : null;
  if (!ctx?.main) return <p className="firm-sub">The sample firm is not set up on this server yet.</p>;
  await ensureBasePlan(ctx.firm, ctx.main);
  const today = isoDay(new Date());
  const rows = await planRows(ctx.firm, ctx.main.number);
  const data = { recall: { number: ctx.main.number, short: ctx.main.short, announced: ctx.main.announced }, today, ...toGantt(rows, today), schedule: await reviewSchedule(ctx.firm) };
  return (
    <>
      <p className="firm-sub" style={{ marginBottom: 16 }}>
        {ctx.main.short}, {recallLabel(ctx.main.number)}. {rows.length} tasks.
      </p>
      <PlanLoader data={data} />
    </>
  );
}

export default function PlanPage() {
  return (
    <>
      <header className="firm-head">
        <div>
          <div className="title-row">
            <h1 className="firm-title">Recall plan</h1>
            <FirmInfo id="firm.gantt" />
          </div>
          <p className="firm-sub">The corrective-action plan updates itself: when a PayPal payout waits to be accepted, a friendly re-notice appears here.</p>
        </div>
      </header>
      <div style={{ marginTop: 16 }}>
        <Suspense fallback={<p className="firm-sub page-loading">Loading the plan&hellip;</p>}>
          <Plan />
        </Suspense>
      </div>
      <p className="firm-label">Tasks marked sample are fictional history. Bryntum Gantt runs as a trial and shows its watermark.</p>
    </>
  );
}
