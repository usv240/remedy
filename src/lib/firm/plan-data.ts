/**
 * The corrective-action plan in Postgres (plan_task) and the review schedule. Server only.
 * The payments engine adds rows here on its own: a "Payout batch" when a batch goes out, an "Unclaimed follow-up" 30
 * days later, and a "Re-notice" when a payout goes UNCLAIMED or RETURNED (src/lib/payments/events.ts). The plan page
 * reads them all and hears new ones over SSE (src/app/api/firm/plan/events/route.ts).
 */
import { sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isoDay } from "./dates";
import type { Firm, FirmRecall } from "./firm";
import { basePlan, MOVABLE, type PlanKind, type PlanRow, type PlanSource } from "./plan";
import { notTest, notTestTask } from "./origin";

const DAY = 86_400_000;
type Raw = { id: number; name: string; kind: PlanKind; start_date: Date | null; duration: string | null; percent_done: string; source: PlanSource; ref: string | null; dependencies: PlanRow["dependencies"]; data: Record<string, unknown>; created_at: Date };

const toRow = (r: Raw): PlanRow => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  start: isoDay(r.start_date ?? r.created_at),
  durationDays: Number(r.duration ?? 1),
  percentDone: Number(r.percent_done ?? 0),
  source: r.source,
  ref: r.ref,
  dependencies: Array.isArray(r.dependencies) ? r.dependencies : [],
  data: r.data ?? {},
});

/** Add the recall's base plan (announcement, two notice waves, three reports) where it is missing. Idempotent. */
export async function ensureBasePlan(firm: Firm, recall: FirmRecall) {
  const tasks = basePlan(recall.number, recall.announced);
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`plan:${firm.id}:${recall.number}`}))`);
    const have = new Map(((await tx.execute(sql`select id, ref from plan_task where firm_id = ${firm.id} and ref like ${`plan:${recall.number}:%`}`)).rows as { id: number; ref: string }[]).map((r) => [r.ref, r.id]));
    for (const [i, t] of tasks.entries()) {
      if (have.has(t.ref)) continue;
      const from = t.dependsOn ? have.get(t.dependsOn) : undefined;
      const start = new Date(`${t.start}T00:00:00Z`);
      const [row] = (
        await tx.execute(sql`
        insert into plan_task (firm_id, recall_number, name, kind, start_date, end_date, duration, duration_unit, percent_done, order_index, dependencies, source, ref, data)
        values (${firm.id}, ${recall.number}, ${t.name}, ${t.kind}, ${start}, ${new Date(start.getTime() + t.duration * DAY)}, ${t.duration}, 'day',
                ${t.kind === "announcement" ? 100 : 0}, ${i}, ${JSON.stringify(from ? [{ from, type: 2 }] : [])}::jsonb, 'seed', ${t.ref}, '{}'::jsonb)
        returning id`)
      ).rows as { id: number }[];
      have.set(t.ref, row.id);
    }
  });
}

/**
 * Every task of the recall's plan. A real payout batch's progress is the share of its payouts PayPal has paid. The
 * whole plan (afterId 0, a page opening) leaves out tasks of test claims (./origin); the live feed after it still
 * streams every new task once, so an open page sees a seeded re-notice arrive.
 */
export async function planRows(firm: Firm, recallNumber: string, afterId = 0): Promise<PlanRow[]> {
  const raw = (
    await db().execute(sql`
    select id, name, kind, start_date, duration, percent_done, source, ref, dependencies, data, created_at
    from plan_task where firm_id = ${firm.id} and (recall_number = ${recallNumber} or recall_number is null) and id > ${afterId}${afterId === 0 ? sql` and ${notTestTask()}` : sql``}
    order by start_date nulls last, order_index, id`)
  ).rows as Raw[];
  const rows = raw.map(toRow);
  const batches = rows.filter((r) => r.kind === "payout_batch" && typeof r.data.payoutBatchId === "string").map((r) => r.data.payoutBatchId as string);
  if (batches.length) {
    const done = (
      await db().execute(sql`
      select paypal_batch_id as b, count(*) filter (where status = 'success')::int as paid, count(*)::int as n
      from payment where paypal_batch_id in (${sql.join(batches.map((b) => sql`${b}`), sql`, `)}) group by paypal_batch_id`)
    ).rows as { b: string; paid: number; n: number }[];
    const by = new Map(done.map((d) => [d.b, d.n ? Math.round((d.paid / d.n) * 100) : 0]));
    for (const r of rows) if (r.kind === "payout_batch" && by.has(r.data.payoutBatchId as string)) r.percentDone = by.get(r.data.payoutBatchId as string)!;
  }
  return rows;
}

export async function lastTaskId(firmId: number): Promise<number> {
  const [r] = (await db().execute(sql`select coalesce(max(id), 0)::int as id from plan_task where firm_id = ${firmId}`)).rows as { id: number }[];
  return r?.id ?? 0;
}

/**
 * Move a task (the keyboard and form alternative to dragging it, and where a drag is saved). Only plans move, never a
 * record of something that happened. Returns the saved row.
 */
export async function moveTask(firm: Firm, id: number, o: { start: string; durationDays?: number; by: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.start) || Number.isNaN(Date.parse(`${o.start}T00:00:00Z`))) return { ok: false as const, plain: "Pick a start date." };
  const [cur] = (await db().execute(sql`select id, kind, duration, start_date, name from plan_task where id = ${id} and firm_id = ${firm.id}`)).rows as { id: number; kind: PlanKind; duration: string | null; start_date: Date | null; name: string }[];
  if (!cur) return { ok: false as const, plain: "That task is not in this plan." };
  if (!MOVABLE.includes(cur.kind)) return { ok: false as const, plain: "This task records something that already happened, so its date stays as it is." };
  const days = o.durationDays === undefined ? Number(cur.duration ?? 1) : Math.round(o.durationDays * 2) / 2;
  if (!(days >= 0.5 && days <= 120)) return { ok: false as const, plain: "A task lasts from half a day to 120 days." };
  const start = new Date(`${o.start}T00:00:00Z`);
  const who = o.by.trim().slice(0, 80) || "Firm reviewer";
  await db().execute(sql`
    update plan_task set start_date = ${start}, end_date = ${new Date(start.getTime() + days * DAY)}, duration = ${days}, source = 'person',
      data = data || ${JSON.stringify({ movedBy: who, movedAt: new Date().toISOString() })}::jsonb, updated_at = now()
    where id = ${id} and firm_id = ${firm.id}`);
  await audit("person", "plan.task_moved", `firm:${firm.id}`, { task: id, from: cur.start_date ? isoDay(cur.start_date) : null, to: o.start, days, by: who });
  const [row] = await planRowsById(firm, id);
  return { ok: true as const, row };
}

async function planRowsById(firm: Firm, id: number) {
  const raw = (await db().execute(sql`select id, name, kind, start_date, duration, percent_done, source, ref, dependencies, data, created_at from plan_task where id = ${id} and firm_id = ${firm.id}`)).rows as Raw[];
  return raw.map(toRow);
}

/** Sample reviewers at Brightline Home (fictional). Ana is the compliance lead. */
export const REVIEWERS = [
  { id: "ana", name: "Ana", role: "Compliance lead" },
  { id: "devon", name: "Devon", role: "Claims reviewer" },
] as const;

export type ReviewEvent = { id: string; resourceId: string; name: string; startDate: string; endDate: string; status: "open" | "done"; claimId: string; eventColor: string; note: string };

/**
 * The review schedule: every claim that went to a person, on the reviewer who has it, sized by the firm's response
 * time (settings.reviewHours, 48 by default) or by how long the review took. Open cases are shared in turn.
 */
export async function reviewSchedule(firm: Firm, now = new Date()) {
  const hours = Number(firm.settings.reviewHours ?? 48) || 48;
  const raw = (
    await db().execute(sql`
    select c.id, c.created_at, c.reviewed_at, c.reviewed_by, c.review_outcome, c.payee_masked, r.products, r.title
    from claim c join recall r on r.number = c.recall_number
    where c.firm_id = ${firm.id} and ${notTest()} and (c.decision = 'firm_review' or c.review_outcome is not null) and c.created_at > ${new Date(now.getTime() - 21 * DAY)}
    order by c.created_at`)
  ).rows as { id: string; created_at: Date; reviewed_at: Date | null; reviewed_by: string | null; review_outcome: string | null; payee_masked: string | null; products: { name?: string }[]; title: string }[];
  let turn = 0;
  const events: ReviewEvent[] = raw.map((c) => {
    const named = REVIEWERS.find((r) => c.reviewed_by && c.reviewed_by.toLowerCase().startsWith(r.name.toLowerCase()));
    const reviewer = named ?? REVIEWERS[turn++ % REVIEWERS.length];
    const start = new Date(c.created_at);
    const due = new Date(start.getTime() + hours * 3_600_000);
    const done = Boolean(c.review_outcome);
    const end = done && c.reviewed_at ? new Date(Math.max(new Date(c.reviewed_at).getTime(), start.getTime() + 3_600_000)) : due;
    const product = c.products?.[0]?.name ?? c.title;
    return {
      id: `rev-${c.id}`,
      resourceId: reviewer.id,
      name: `${done ? "Reviewed" : "Review"}: ${product}`,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status: done ? "done" : "open",
      claimId: c.id,
      eventColor: done ? "green" : "orange",
      note: `${c.payee_masked ?? "Owner"}. ${done ? `Outcome: ${c.review_outcome}${c.reviewed_by ? `, by ${c.reviewed_by}` : ""}.` : `Answer due within ${hours} hours.`}`,
    };
  });
  return { resources: REVIEWERS.map((r) => ({ id: r.id, name: r.name, role: r.role })), events, hours };
}
