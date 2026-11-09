import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ClaimsQueue, type View } from "@/components/firm/ClaimsQueue";
import { FirmInfo } from "@/components/firm/FirmInfo";
import { dbConfigured } from "@/lib/db";
import { firmContext } from "@/lib/firm/firm";
import { queueRows } from "@/lib/firm/queue";
import { ensureReadyClaims } from "@/lib/firm/sample-claims";

export const metadata: Metadata = { title: "Claims queue", description: "Every claim for Brightline Home's recalls, with its photo, the six checks, the decision and the payout. A fictional sample firm." };

const VIEWS: View[] = ["all", "review", "ready", "paid_today", "unclaimed"];

async function Queue({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await connection();
  const { view } = await searchParams;
  const ctx = dbConfigured() ? await firmContext().catch(() => null) : null;
  if (!ctx) return <p className="firm-sub">The sample firm is not set up on this server yet.</p>;
  // Two sample claims stay ready to pay, so Approve and pay always has something to send.
  await ensureReadyClaims(ctx.firm.id, ctx.main?.number).catch(() => 0);
  const rows = await queueRows(ctx.firm.id);
  return <ClaimsQueue initial={rows} initialView={VIEWS.includes(view as View) ? (view as View) : "all"} />;
}

export default function ClaimsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return (
    <>
      <header className="firm-head">
        <div>
          <div className="title-row">
            <h1 className="firm-title">Claims</h1>
            <FirmInfo id="firm.queue" />
          </div>
          <p className="firm-sub">Every claim with its photo and the six checks. Verified claims can be paid together in one PayPal batch.</p>
        </div>
      </header>
      <div style={{ marginTop: 20 }}>
        <Suspense fallback={<p className="firm-sub page-loading">Loading the claims&hellip;</p>}>
          <Queue searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="firm-label">Sample claims are fictional and marked sample. Paying a claim sends a real PayPal sandbox payout; the sample claims ready to pay are at the recall&rsquo;s refund of $34.99, and two more are added when they have been paid.</p>
    </>
  );
}
