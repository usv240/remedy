/**
 * The console's home: the main recall's progress, what needs a person, the next CPSC report and the payouts nobody
 * has accepted yet. Every figure is counted here from the database, leaving out rows a test script made (./origin).
 * Server only.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { daysBetween, isoDay, nextReportDue } from "./dates";
import type { Firm, FirmRecall } from "./firm";
import { payFromDb, SAMPLE_PAYPAL_STATUS } from "./queue";
import { notTest } from "./origin";
import { completion } from "./report";
import type { HomeSummary } from "./types";

/** How many of the payouts waiting to be accepted the home tile lists; the count above the list covers them all. */
export const UNCLAIMED_SHOWN = 6;

export async function homeSummary(firm: Firm, main: FirmRecall, others: FirmRecall[], now = new Date()): Promise<HomeSummary> {
  const [c] = (
    await db().execute(sql`
    select count(*)::int as total,
      count(*) filter (where decision = 'verified' and coalesce(review_outcome, '') not in ('retake', 'declined') or review_outcome = 'approved')::int as verified,
      coalesce(sum(units_claimed) filter (where decision = 'verified' and coalesce(review_outcome, '') not in ('retake', 'declined') or review_outcome = 'approved'), 0)::int as units,
      count(*) filter (where is_sample)::int as sample
    from claim where firm_id = ${firm.id} and recall_number = ${main.number} and ${notTest("claim")}`)
  ).rows as { total: number; verified: number; units: number; sample: number }[];

  const [p] = (
    await db().execute(sql`
    select count(*)::int as n, coalesce(sum(p.amount), 0)::text as usd
    from payment p join claim c on c.id = p.claim_id
    where c.firm_id = ${firm.id} and c.recall_number = ${main.number} and ${notTest()} and ((p.route = 'payout' and p.status = 'success') or (p.route = 'refund' and p.status = 'refunded'))`)
  ).rows as { n: number; usd: string }[];

  // Needs a person: firm-review claims nobody has decided, and payments that could not be sent.
  const [q] = (
    await db().execute(sql`
    select
      count(*) filter (where c.decision = 'firm_review' and c.review_outcome is null and p.id is null)::int as review,
      count(*) filter (where p.status in ('failed', 'blocked'))::int as failed,
      count(*) filter (where (c.decision = 'verified' or c.review_outcome = 'approved') and coalesce(c.review_outcome, '') not in ('retake', 'declined') and p.id is null and c.amount > 0)::int as ready
    from claim c left join lateral (select id, status from payment x where x.claim_id = c.id order by x.id desc limit 1) p on true
    where c.firm_id = ${firm.id} and ${notTest()}`)
  ).rows as { review: number; failed: number; ready: number }[];

  // Waiting to be accepted, as the claims queue counts it (stageOf in ./queue): a claim whose latest payment PayPal holds
  // as unclaimed or returned, not since declined or sent back for a new photo. The count is its own query; the list
  // beside it shows the oldest few.
  const waiting = sql`
    from claim c join lateral (select * from payment x where x.claim_id = c.id order by x.id desc limit 1) p on true
    where c.firm_id = ${firm.id} and ${notTest()} and p.status in ('unclaimed', 'returned') and coalesce(c.review_outcome, '') not in ('declined', 'retake')`;
  const [w] = (await db().execute(sql`select count(*)::int as n ${waiting}`)).rows as { n: number }[];
  const unclaimed = (
    await db().execute(sql`
    select c.id, c.payee_masked, p.amount::text as amount, p.created_at, p.status, p.route, p.paypal_status
    ${waiting}
    order by p.created_at asc limit ${UNCLAIMED_SHOWN}`)
  ).rows as { id: string; payee_masked: string | null; amount: string; created_at: Date; status: string; route: string; paypal_status: string | null }[];

  const counts = (
    await db().execute(sql`select recall_number, count(*)::int as n from claim where firm_id = ${firm.id} and ${notTest("claim")} group by recall_number`)
  ).rows as { recall_number: string; n: number }[];
  const byRecall = new Map(counts.map((r) => [r.recall_number, r.n]));

  const due = nextReportDue(main.announced, now);
  return {
    firm: { name: firm.name, isSample: firm.isSample },
    recall: { number: main.number, title: main.title, short: main.short, units: main.units, unitsText: main.unitsText, announced: main.announced, daysSince: Math.max(0, daysBetween(main.announced, now)), image: main.image },
    claimsTotal: c?.total ?? 0,
    claimsVerified: c?.verified ?? 0,
    unitsCorrected: c?.units ?? 0,
    refundsPaid: { count: p?.n ?? 0, cents: Math.round(Number(p?.usd ?? 0) * 100) },
    completionPercent: completion(c?.units ?? 0, main.units) ?? 0,
    needsReview: (q?.review ?? 0) + (q?.failed ?? 0),
    readyToPay: q?.ready ?? 0,
    nextReport: due ? { index: due.index, month: due.month, dueOn: due.dueOn, daysLeft: daysBetween(isoDay(now), due.dueOn) } : null,
    unclaimed: unclaimed.map((u) => ({
      claimId: u.id,
      claimant: u.payee_masked ?? "Owner",
      amountCents: Math.round(Number(u.amount) * 100),
      since: new Date(u.created_at).toISOString(),
      sample: u.paypal_status === SAMPLE_PAYPAL_STATUS,
      status: payFromDb(u.status, u.route),
    })),
    unclaimedCount: w?.n ?? 0,
    sampleClaims: c?.sample ?? 0,
    claimsAllRecalls: { claims: counts.reduce((s, r) => s + r.n, 0), recalls: counts.length },
    otherRecalls: others.map((r) => ({ number: r.number, short: r.short, claims: byRecall.get(r.number) ?? 0 })),
  };
}
