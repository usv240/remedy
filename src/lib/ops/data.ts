/**
 * What /ops shows, read from the tables the app already writes: request_log, audit_event, api_usage, ai_usage,
 * payment, payment_plan, webhook_event, claim, job and integration_status. Every figure is a count or a timing;
 * nothing here names a person, a payee, a photo or an address, and ids are shortened before they leave. Server only.
 */
import { sql } from "drizzle-orm";
import { dailyBudgetUsd, spendToday } from "../ai/usage";
import { db, dbConfigured } from "../db";
import { queueStats, WORKER_STALE_MS, type QueueStats } from "../jobs/queue";
import { lastRun } from "../recall/daily";

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (dbConfigured() ? ((await db().execute(q)).rows as T[]) : []);
const n = (v: unknown) => Number(v ?? 0);

/** "claim:3f2a9c1e-…" reads "claim:3f2a9c1e"; a request id keeps its first 12 characters. */
export function shortRef(ref: string): string {
  return ref.replace(/([0-9a-f]{8})[0-9a-f-]{20,}/gi, "$1…").replace(/(req_[A-Za-z0-9]{8})[A-Za-z0-9]+/g, "$1…");
}

// ---------------------------------------------------------------------------------------------------------------
// Right now
// ---------------------------------------------------------------------------------------------------------------

export type Now = {
  requestsLastHour: number;
  errorsLastHour: number;
  ai: { usd: number; calls: number; budget: number };
  queue: QueueStats | null;
  workerFresh: boolean;
  ingest: Awaited<ReturnType<typeof lastRun>>;
};

export async function rightNow(): Promise<Now> {
  const [req, ai, queue, ingest] = await Promise.all([
    rows<{ n: number; errors: number }>(sql`select count(*)::int as n, count(*) filter (where status >= 500)::int as errors from request_log where created > now() - interval '1 hour'`),
    spendToday().catch(() => ({ usd: 0, calls: 0, source: "memory" as const })),
    dbConfigured() ? queueStats().catch(() => null) : Promise.resolve(null),
    lastRun().catch(() => null),
  ]);
  return {
    requestsLastHour: n(req[0]?.n),
    errorsLastHour: n(req[0]?.errors),
    ai: { usd: ai.usd, calls: ai.calls, budget: dailyBudgetUsd() },
    queue,
    workerFresh: Boolean(queue?.workerSeenAt && Date.now() - queue.workerSeenAt.getTime() < WORKER_STALE_MS),
    ingest,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Last 24 hours
// ---------------------------------------------------------------------------------------------------------------

export type RouteStat = { route: string; count: number; p50: number; p95: number; errors: number; clientErrors: number; errorRate: number };

export async function routes24h(): Promise<RouteStat[]> {
  const r = await rows<{ route: string; n: number; p50: number; p95: number; errors: number; client_errors: number }>(sql`
    select route, count(*)::int as n,
      percentile_cont(0.5) within group (order by ms)::int as p50,
      percentile_cont(0.95) within group (order by ms)::int as p95,
      count(*) filter (where status >= 500)::int as errors,
      count(*) filter (where status >= 400 and status < 500)::int as client_errors
    from request_log where created > now() - interval '24 hours' group by route order by n desc limit 40`);
  return r.map((x) => ({ route: x.route, count: n(x.n), p50: n(x.p50), p95: n(x.p95), errors: n(x.errors), clientErrors: n(x.client_errors), errorRate: n(x.n) ? n(x.errors) / n(x.n) : 0 }));
}

export type Counts = { label: string; count: number }[];

/** Payments by status: plans waiting for a person or approved, then payments as PayPal reported them. */
export async function payments24h(): Promise<Counts> {
  const [plans, pays] = await Promise.all([
    rows<{ s: string; n: number }>(sql`
      select coalesce(detail->>'status', case status when 'planned' then 'awaiting_approval' when 'done' then 'paid' else status end) as s, count(*)::int as n
      from payment_plan where created_at > now() - interval '24 hours' group by 1`),
    rows<{ s: string; n: number }>(sql`select status as s, count(*)::int as n from payment where created_at > now() - interval '24 hours' group by 1`),
  ]);
  const plan = Object.fromEntries(plans.map((p) => [p.s, n(p.n)]));
  const pay = Object.fromEntries(pays.map((p) => [p.s, n(p.n)]));
  return [
    { label: "Planned, waiting for a person", count: plan.awaiting_approval ?? 0 },
    { label: "Approved, not yet sent", count: plan.approved ?? 0 },
    { label: "On their way", count: (pay.pending ?? 0) + (plan.executing ?? 0) + (plan.submitted ?? 0) },
    { label: "Paid", count: pay.success ?? 0 },
    { label: "Waiting to be accepted", count: pay.unclaimed ?? 0 },
    { label: "Returned", count: (pay.returned ?? 0) + (pay.refunded ?? 0) + (pay.reversed ?? 0) },
    { label: "Did not go through", count: (pay.failed ?? 0) + (pay.blocked ?? 0) + (pay.canceled ?? 0) },
  ];
}

export type Webhooks = { handled: number; untrusted: number; duplicates: number; byType: Counts };

export async function webhooks24h(): Promise<Webhooks> {
  const [w, dup] = await Promise.all([
    rows<{ t: string; verified: boolean; n: number }>(sql`select event_type as t, verified, count(*)::int as n from webhook_event where received_at > now() - interval '24 hours' group by 1, 2`),
    rows<{ n: number }>(sql`select count(*)::int as n from audit_event where action = 'paypal.webhook.duplicate' and at > now() - interval '24 hours'`),
  ]);
  const byType = new Map<string, number>();
  let handled = 0;
  let untrusted = 0;
  for (const x of w) {
    if (x.verified) handled += n(x.n);
    else untrusted += n(x.n);
    byType.set(x.t, (byType.get(x.t) ?? 0) + n(x.n));
  }
  return { handled, untrusted, duplicates: n(dup[0]?.n), byType: [...byType].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) };
}

export async function decisions24h(): Promise<Counts> {
  const r = await rows<{ d: string; n: number }>(sql`select decision as d, count(*)::int as n from claim where created_at > now() - interval '24 hours' group by 1`);
  const by = Object.fromEntries(r.map((x) => [x.d, n(x.n)]));
  return [
    { label: "Verified", count: by.verified ?? 0 },
    { label: "Retake asked", count: by.retake ?? 0 },
    { label: "A person looks", count: by.firm_review ?? 0 },
    { label: "Still checking", count: by.pending ?? 0 },
  ];
}

export type AiRoute = { route: string; calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; usd: number };

export async function ai24h(): Promise<AiRoute[]> {
  const r = await rows<{ route: string; calls: number; i: number; o: number; c: number; usd: string }>(sql`
    select route, count(*)::int as calls, sum(input_tokens)::int as i, sum(output_tokens)::int as o, sum(cache_read_input_tokens)::int as c, sum(usd) as usd
    from ai_usage where at > now() - interval '24 hours' group by route order by sum(usd) desc`);
  return r.map((x) => ({ route: x.route, calls: n(x.calls), inputTokens: n(x.i), outputTokens: n(x.o), cacheReadTokens: n(x.c), usd: Number(x.usd ?? 0) }));
}

// ---------------------------------------------------------------------------------------------------------------
// Reliability over time: requests and errors per hour, 7 days
// ---------------------------------------------------------------------------------------------------------------

export type HourPoint = { hour: string; requests: number; errors: number };

export async function hourly7d(now = new Date()): Promise<HourPoint[]> {
  const r = await rows<{ h: Date; n: number; errors: number }>(sql`
    select date_trunc('hour', created) as h, count(*)::int as n, count(*) filter (where status >= 500)::int as errors
    from request_log where created > now() - interval '7 days' group by 1`);
  const by = new Map(r.map((x) => [new Date(x.h).toISOString(), x]));
  const out: HourPoint[] = [];
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  for (let i = 167; i >= 0; i--) {
    const h = new Date(start.getTime() - i * 3_600_000).toISOString();
    const x = by.get(h);
    out.push({ hour: h, requests: n(x?.n), errors: n(x?.errors) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The live feed and the trace
// ---------------------------------------------------------------------------------------------------------------

export type FeedItem = { kind: "ledger"; id: number; at: string; actor: string; action: string; ref: string } | { kind: "request"; id: number; at: string; route: string; status: number; ms: number; requestId: string };

/** The newest ledger entries and requests, as one feed. `after` carries the last ids a client saw. */
export async function feed(after: { ledger?: number; request?: number } = {}, limit = 50): Promise<FeedItem[]> {
  const [l, r] = await Promise.all([
    rows<{ id: number; at: Date; actor: string; action: string; ref: string }>(sql`select id, at, actor, action, ref from audit_event where id > ${after.ledger ?? 0} order by id desc limit ${limit}`),
    rows<{ id: number; created: Date; route: string; status: number; ms: number; request_id: string }>(sql`select id, created, route, status, ms, request_id from request_log where id > ${after.request ?? 0} order by id desc limit ${limit}`),
  ]);
  const items: FeedItem[] = [
    ...l.map((x) => ({ kind: "ledger" as const, id: n(x.id), at: new Date(x.at).toISOString(), actor: x.actor, action: x.action, ref: shortRef(x.ref) })),
    ...r.map((x) => ({ kind: "request" as const, id: n(x.id), at: new Date(x.created).toISOString(), route: x.route, status: n(x.status), ms: n(x.ms), requestId: shortRef(x.request_id) })),
  ];
  return items.sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1)).slice(0, limit);
}

export const isRequestId = (s: string) => /^[A-Za-z0-9_.-]{8,64}$/.test(s);

export type Trace = {
  requestId: string;
  requests: { at: string; route: string; status: number; ms: number }[];
  ledger: { at: string; actor: string; action: string; ref: string }[];
};

/** Everything one request id touched: its request_log rows and the ledger entries written under it. */
export async function trace(requestId: string): Promise<Trace> {
  const [r, l] = await Promise.all([
    rows<{ created: Date; route: string; status: number; ms: number }>(sql`select created, route, status, ms from request_log where request_id = ${requestId} order by id`),
    rows<{ at: Date; actor: string; action: string; ref: string }>(sql`select at, actor, action, ref from audit_event where detail->>'request_id' = ${requestId} order by id`),
  ]);
  return {
    requestId,
    requests: r.map((x) => ({ at: new Date(x.created).toISOString(), route: x.route, status: n(x.status), ms: n(x.ms) })),
    ledger: l.map((x) => ({ at: new Date(x.at).toISOString(), actor: x.actor, action: x.action, ref: shortRef(x.ref) })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Alerts: the conditions a pager would watch, computed live
// ---------------------------------------------------------------------------------------------------------------

export type Alert = { id: string; name: string; rule: string; ok: boolean; detail: string };

export async function alerts(now: Now): Promise<Alert[]> {
  const [err15, unverified, failedPayouts] = await Promise.all([
    rows<{ n: number; errors: number }>(sql`select count(*)::int as n, count(*) filter (where status >= 500)::int as errors from request_log where created > now() - interval '15 minutes'`),
    rows<{ n: number }>(sql`select count(*)::int as n from webhook_event where verified = false and received_at > now() - interval '24 hours'`),
    rows<{ n: number }>(sql`select count(*)::int as n from payment where status in ('failed', 'blocked') and updated_at > now() - interval '24 hours'`),
  ]);
  const total = n(err15[0]?.n);
  const errors = n(err15[0]?.errors);
  const rate = total ? errors / total : 0;
  const oldest = now.queue?.oldestWaitingSec ?? 0;
  const waiting = (now.queue?.queued ?? 0) + (now.queue?.running ?? 0);
  const budget = now.ai.budget;
  const unv = n(unverified[0]?.n);
  const fp = n(failedPayouts[0]?.n);
  return [
    { id: "errors", name: "Error rate", rule: "Over 5% of API requests answered 5xx in the last 15 minutes", ok: rate <= 0.05, detail: total ? `${errors} of ${total} requests (${(rate * 100).toFixed(1)}%)` : "No requests in the last 15 minutes" },
    { id: "queue", name: "Queue age", rule: "A job has waited more than 5 minutes", ok: !(waiting && oldest > 300), detail: waiting ? `${waiting} waiting, oldest ${oldest} s` : "Nothing waiting" },
    { id: "worker", name: "Worker heartbeat", rule: "No worker reported in for 90 seconds", ok: now.workerFresh, detail: now.workerFresh ? "A worker is running" : "No worker running; routes run their jobs inline" },
    { id: "ai", name: "AI spend", rule: "Today's Claude spend reached the daily cap", ok: !(Number.isFinite(budget) && now.ai.usd >= budget), detail: Number.isFinite(budget) ? `$${now.ai.usd.toFixed(2)} of $${budget.toFixed(2)}` : `$${now.ai.usd.toFixed(2)}, no cap on this machine` },
    { id: "webhook", name: "Webhook trust", rule: "A webhook arrived that PayPal would not verify, in the last 24 hours", ok: unv === 0, detail: unv ? `${unv} unverified ${unv === 1 ? "event" : "events"}, stored and ignored` : "Every event verified" },
    { id: "payout", name: "Payouts", rule: "A payout failed or was blocked in the last 24 hours", ok: fp === 0, detail: fp ? `${fp} ${fp === 1 ? "payment" : "payments"} for a person at the firm` : "None failed" },
    { id: "dead", name: "Dead letters", rule: "A job failed after its fifth try", ok: !(now.queue?.failed), detail: now.queue?.failed ? `${now.queue.failed} ${now.queue.failed === 1 ? "job" : "jobs"} need a person` : "None" },
  ];
}
