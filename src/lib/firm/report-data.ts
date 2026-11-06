/**
 * The monthly progress report's numbers, counted in SQL from the claim, payment and notice tables. Server only.
 * Definitions (each one is also in the report's Technical view):
 * - a correction is a unit on a claim verified made safe: decision "verified", or approved by a reviewer after review;
 *   it counts on the day it was verified (decided_at) or approved (reviewed_at);
 * - a refund is paid when PayPal says so: a payout item SUCCESS, or a capture refund COMPLETED (payment.paid_at);
 * - an unclaimed payout is one sent and not accepted yet (UNCLAIMED) or returned to the firm after 30 days;
 * - consumers notified are distinct people sent a notice in the period, by channel.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { reportPeriod, type ReportPeriod } from "./dates";
import type { Firm, FirmRecall } from "./firm";
import { buildReport, type ReportCounts, type ReportNumbers } from "./report";

const n = (v: unknown) => Number(v ?? 0) || 0;
const c = (v: unknown) => Math.round(Number(v ?? 0) * 100) || 0;

export async function reportCounts(firmId: number, recallNumber: string, p: Pick<ReportPeriod, "fromInclusive" | "untilExclusive">): Promise<ReportCounts> {
  const s = p.fromInclusive.toISOString();
  const e = p.untilExclusive.toISOString();
  const [claims] = (
    await db().execute(sql`
    with v as (
      select c.*,
        case
          when c.review_outcome = 'approved' then coalesce(c.reviewed_at, c.decided_at, c.created_at)
          when c.decision = 'verified' and coalesce(c.review_outcome, '') not in ('retake', 'declined') then coalesce(c.decided_at, c.created_at)
        end as verified_at
      from claim c where c.firm_id = ${firmId} and c.recall_number = ${recallNumber}
    )
    select
      count(*) filter (where created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz) as received,
      count(*) filter (where created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz and is_sample) as received_sample,
      coalesce(sum(units_claimed) filter (where verified_at >= ${s}::timestamptz and verified_at < ${e}::timestamptz), 0) as corrections_period,
      coalesce(sum(units_claimed) filter (where verified_at < ${e}::timestamptz), 0) as corrections_total,
      count(*) filter (where verified_at >= ${s}::timestamptz and verified_at < ${e}::timestamptz) as verified,
      count(*) filter (where decision = 'firm_review' and review_outcome is null and created_at < ${e}::timestamptz) as in_review,
      count(*) filter (where (decision = 'retake' or review_outcome = 'retake') and created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz) as retakes,
      count(*) filter (where channel = 'email' and created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz) as contacted_email,
      count(*) filter (where channel <> 'email' and created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz) as contacted_online
    from v`)
  ).rows as Record<string, unknown>[];

  const [pay] = (
    await db().execute(sql`
    select
      count(*) filter (where ((p.route = 'payout' and p.status = 'success') or (p.route = 'refund' and p.status = 'refunded')) and p.paid_at >= ${s}::timestamptz and p.paid_at < ${e}::timestamptz) as paid_n,
      coalesce(sum(p.amount) filter (where ((p.route = 'payout' and p.status = 'success') or (p.route = 'refund' and p.status = 'refunded')) and p.paid_at >= ${s}::timestamptz and p.paid_at < ${e}::timestamptz), 0) as paid_usd,
      count(*) filter (where p.route = 'replacement' and p.status = 'success' and p.paid_at >= ${s}::timestamptz and p.paid_at < ${e}::timestamptz) as repl_n,
      coalesce(sum(p.amount) filter (where p.route = 'replacement' and p.status = 'success' and p.paid_at >= ${s}::timestamptz and p.paid_at < ${e}::timestamptz), 0) as repl_usd,
      count(*) filter (where p.status in ('unclaimed', 'returned') and p.created_at < ${e}::timestamptz) as unclaimed_n,
      coalesce(sum(p.amount) filter (where p.status in ('unclaimed', 'returned') and p.created_at < ${e}::timestamptz), 0) as unclaimed_usd
    from payment p join claim c on c.id = p.claim_id
    where c.firm_id = ${firmId} and c.recall_number = ${recallNumber}`)
  ).rows as Record<string, unknown>[];

  const [notices] = (
    await db().execute(sql`
    select
      count(distinct coalesce(recipient_hash, id::text)) filter (where channel = 'email') as email,
      count(distinct coalesce(recipient_hash, id::text)) filter (where channel = 'sms') as sms,
      count(distinct coalesce(recipient_hash, id::text)) filter (where channel = 'letter') as mail
    from notice
    where firm_id = ${firmId} and recall_number = ${recallNumber} and status in ('sent', 'opened', 'claimed')
      and sent_at >= ${s}::timestamptz and sent_at < ${e}::timestamptz`)
  ).rows as Record<string, unknown>[];

  return {
    claimsReceived: n(claims.received),
    claimsReceivedSample: n(claims.received_sample),
    correctionsThisPeriod: n(claims.corrections_period),
    correctionsCumulative: n(claims.corrections_total),
    claimsVerified: n(claims.verified),
    claimsInReview: n(claims.in_review),
    retakesAsked: n(claims.retakes),
    refundsPaidCount: n(pay.paid_n),
    refundsPaidCents: c(pay.paid_usd),
    replacementsCount: n(pay.repl_n),
    replacementsCents: c(pay.repl_usd),
    unclaimedCount: n(pay.unclaimed_n),
    unclaimedCents: c(pay.unclaimed_usd),
    notifiedEmail: n(notices.email),
    notifiedSms: n(notices.sms),
    notifiedMail: n(notices.mail),
    contactedEmail: n(claims.contacted_email),
    contactedOnline: n(claims.contacted_online),
  };
}

/** The whole report for one month, or null before the recall's announcement month. */
export async function loadReport(firm: Firm, recall: FirmRecall, month: string, now = new Date()): Promise<ReportNumbers | null> {
  const period = reportPeriod(month, recall.announced, now);
  if (!period) return null;
  const counts = await reportCounts(firm.id, recall.number, period);
  return buildReport({ counts, period, firm, recall, now });
}

/** The narrative stored for this month, with the numbers it was written from. */
export async function storedNarrative(firmId: number, recallNumber: string, month: string) {
  const [r] = (
    await db().execute(sql`select numbers, narrative, narrative_model, updated_at from report where firm_id = ${firmId} and recall_number = ${recallNumber} and month = ${month}`)
  ).rows as { numbers: Record<string, unknown>; narrative: string | null; narrative_model: string | null; updated_at: Date }[];
  return r ?? null;
}

export async function saveNarrative(firmId: number, recallNumber: string, month: string, numbers: ReportNumbers, narrative: string, model: string | null) {
  await db().execute(sql`
    insert into report (firm_id, recall_number, month, numbers, narrative, narrative_model, status)
    values (${firmId}, ${recallNumber}, ${month}, ${JSON.stringify(numbers)}::jsonb, ${narrative}, ${model}, 'draft')
    on conflict (firm_id, recall_number, month)
    do update set numbers = excluded.numbers, narrative = excluded.narrative, narrative_model = excluded.narrative_model, updated_at = now()`);
}
