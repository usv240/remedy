import { and, desc, eq, gte, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { PlanDependency } from "@/lib/db/schema";
import { toCents, toValue } from "./deps";
import { seal, unseal } from "./seal";
import type { PaymentQuery, PaymentStore } from "./store";
import type { PayeeType, PaymentPlan, PaymentRecord, PaymentRoute, PaymentStatus, PlanStatus, PlanTaskRecord, Replacement, Sale, WebhookEventRecord } from "./types";

/**
 * The Postgres store, on the shell's tables (db/schema.sql). Where the table's words differ from the engine's, this
 * file translates:
 * - payment_plan.status has planned | approved | executing | done | failed | canceled. The engine's finer status
 *   (awaiting_approval, submitted, paid) is kept in detail.status, and the compare-and-set reads that.
 * - payment.status has pending | success | refunded | onhold | ...; the engine says sending | paid | on_hold.
 * - The payee for a payout is sealed (AES-256-GCM) in payment_plan.detail; the claims grid uses claim.payee_masked.
 * - plan_task has no unique key, so each add takes an advisory lock on its ref and checks first.
 */

const { paymentPlans: P, payments: Pay, sales: S, webhookEvents: W, planTasks: T, firms: F, claims: C } = schema;
type PlanRow = typeof P.$inferSelect;
type PayRow = typeof Pay.$inferSelect;
type SaleRow = typeof S.$inferSelect;
type TaskRow = typeof T.$inferSelect;
const DAY = 86_400_000;

const PLAN_TO_DB: Record<PlanStatus, string> = { awaiting_approval: "planned", approved: "approved", executing: "executing", submitted: "executing", paid: "done", failed: "failed", canceled: "canceled" };
const PLAN_FROM_DB: Record<string, PlanStatus> = { planned: "awaiting_approval", approved: "approved", executing: "executing", done: "paid", failed: "failed", canceled: "canceled" };
/** The engine's plan status, read the same way in SQL and in code. */
const planStatusSql = sql<string>`coalesce(${P.detail}->>'status', case ${P.status} when 'planned' then 'awaiting_approval' when 'done' then 'paid' else ${P.status} end)`;

function payToDb(s: PaymentStatus, route: PaymentRoute) {
  if (s === "sending") return "pending";
  if (s === "paid") return route === "refund" ? "refunded" : "success";
  if (s === "on_hold") return "onhold";
  return s;
}
function payFromDb(s: string, route: string): PaymentStatus {
  if (s === "pending") return "sending";
  if (s === "success") return "paid";
  if (s === "refunded") return route === "refund" ? "paid" : "reversed";
  if (s === "onhold") return "on_hold";
  return s as PaymentStatus;
}
const payStatusesToDb = (list: PaymentStatus[]) => [...new Set(list.flatMap((s) => (s === "paid" ? ["success", "refunded"] : [payToDb(s, "payout")])))];

type PlanDetail = {
  status?: PlanStatus;
  attempt?: number;
  firmId?: string | null;
  recallNumber?: string;
  recallTitle?: string;
  payee?: { type: PayeeType; masked: string; sealed: string } | null;
  captureId?: string | null;
  replacement?: Replacement | null;
  reasons?: { plain: string; technical: string };
  approvalRule?: string | null;
};

const mask = (type: PayeeType, v: string) => (type === "email" ? `${v.slice(0, 1)}***@${v.split("@")[1] ?? ""}` : `***-***-${v.replace(/\D/g, "").slice(-4)}`);

function planDetail(p: PaymentPlan): PlanDetail {
  return {
    status: p.status,
    attempt: p.attempt,
    firmId: p.firmId,
    recallNumber: p.recallNumber,
    recallTitle: p.recallTitle,
    payee: p.payee ? { type: p.payee.type, masked: mask(p.payee.type, p.payee.value), sealed: seal(p.payee.value) } : null,
    captureId: p.captureId,
    replacement: p.replacement,
    reasons: p.reasons,
    approvalRule: p.approval?.rule ?? null,
  };
}

function toPlan(r: PlanRow): PaymentPlan {
  const d = (r.detail ?? {}) as PlanDetail;
  let payee: PaymentPlan["payee"] = null;
  if (d.payee) {
    try {
      payee = { type: d.payee.type, value: unseal(d.payee.sealed) };
    } catch {
      payee = null; // The key changed: the plan still reads, and paying it asks for the payee again.
    }
  }
  return {
    id: String(r.id),
    claimId: r.claimId,
    firmId: d.firmId ?? null,
    recallNumber: d.recallNumber ?? "",
    recallTitle: d.recallTitle ?? "",
    route: r.route as PaymentRoute,
    amountCents: toCents(r.amount),
    currency: "USD",
    payee,
    captureId: d.captureId ?? null,
    replacement: d.replacement ?? null,
    reasons: d.reasons ?? { plain: "", technical: "" },
    approval: r.approval ? { by: r.approval === "auto" ? "auto_rule" : "reviewer", who: r.approvedBy ?? "", rule: d.approvalRule ?? undefined, at: r.approvedAt?.toISOString() ?? r.updatedAt.toISOString() } : null,
    status: d.status ?? PLAN_FROM_DB[r.status] ?? "awaiting_approval",
    attempt: d.attempt ?? 1,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPayment(r: PayRow, firmId: number | null): PaymentRecord {
  const attempt = Number(/-a(\d+)$/.exec(r.requestId ?? "")?.[1] ?? 1);
  const payeeType: PayeeType | null = r.recipientType === "EMAIL" ? "email" : r.recipientType === "PHONE" ? (r.recipientWallet === "VENMO" ? "venmo" : "phone") : null;
  return {
    id: String(r.id),
    planId: String(r.planId),
    claimId: r.claimId,
    attempt,
    requestId: r.requestId ?? "",
    firmId: firmId === null ? null : String(firmId),
    route: r.route as PaymentRoute,
    amountCents: toCents(r.amount),
    currency: "USD",
    status: payFromDb(r.status, r.route),
    paypalStatus: r.paypalStatus,
    payeeType,
    senderBatchId: r.senderBatchId,
    senderItemId: r.senderItemId,
    payoutBatchId: r.paypalBatchId,
    payoutItemId: r.paypalItemId,
    transactionId: r.paypalTransactionId,
    captureId: r.paypalCaptureId,
    refundId: r.paypalRefundId,
    orderId: r.paypalOrderId,
    debugId: r.debugId,
    issue: ((r.error ?? null) as { issue?: string } | null)?.issue ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function paymentColumns(p: Partial<PaymentRecord>, route: PaymentRoute) {
  const c: Partial<typeof Pay.$inferInsert> = {};
  if (p.status !== undefined) {
    c.status = payToDb(p.status, route);
    if (p.status === "paid") c.paidAt = new Date();
  }
  if (p.paypalStatus !== undefined) c.paypalStatus = p.paypalStatus;
  if (p.senderBatchId !== undefined) c.senderBatchId = p.senderBatchId;
  if (p.senderItemId !== undefined) c.senderItemId = p.senderItemId;
  if (p.payoutBatchId !== undefined) c.paypalBatchId = p.payoutBatchId;
  if (p.payoutItemId !== undefined) c.paypalItemId = p.payoutItemId;
  if (p.transactionId !== undefined) c.paypalTransactionId = p.transactionId;
  if (p.captureId !== undefined) c.paypalCaptureId = p.captureId;
  if (p.refundId !== undefined) c.paypalRefundId = p.refundId;
  if (p.orderId !== undefined) c.paypalOrderId = p.orderId;
  if (p.debugId !== undefined) c.debugId = p.debugId;
  if (p.issue !== undefined) c.error = p.issue ? { issue: p.issue } : null;
  if (p.payeeType !== undefined) {
    c.recipientType = p.payeeType === "email" ? "EMAIL" : p.payeeType ? "PHONE" : null;
    c.recipientWallet = p.payeeType === "venmo" ? "VENMO" : p.payeeType ? "PAYPAL" : null;
  }
  return c;
}

function toSale(r: SaleRow): Sale {
  return {
    id: String(r.id),
    firmId: String(r.firmId),
    source: r.source as Sale["source"],
    buyerEmailHash: r.buyerEmailHash,
    itemName: r.itemName,
    sku: r.sku,
    amountCents: toCents(r.amount),
    paidAt: (r.paidAt ?? r.createdAt).toISOString(),
    paypalCaptureId: r.paypalCaptureId,
    paypalOrderId: r.paypalOrderId,
  };
}

function toTask(r: TaskRow): PlanTaskRecord {
  const data = (r.data ?? {}) as Record<string, unknown>;
  return {
    key: r.ref ?? `task:${r.id}`,
    firmId: String(r.firmId),
    recallNumber: r.recallNumber,
    kind: r.kind as PlanTaskRecord["kind"],
    source: (r.source === "seed" ? "system" : r.source) as PlanTaskRecord["source"],
    name: r.name,
    startDate: (r.startDate ?? r.createdAt).toISOString().slice(0, 10),
    durationDays: Number(r.duration ?? 1),
    dependsOn: typeof data.dependsOn === "string" ? data.dependsOn : null,
    data,
  };
}

const numericId = (id: string) => (/^\d+$/.test(id) ? Number(id) : null);

export class PgStore implements PaymentStore {
  private firmId: Promise<string | null> | null = null;

  /** Brightline Home, the seeded sample firm (`is_sample = true`). */
  sampleFirmId() {
    this.firmId ??= db()
      .select({ id: F.id })
      .from(F)
      .where(eq(F.isSample, true))
      .orderBy(F.id)
      .limit(1)
      .then(([r]) => (r ? String(r.id) : null));
    return this.firmId.then((v) => {
      if (v === null) this.firmId = null; // Not seeded yet: ask again next time.
      return v;
    });
  }

  private async firmOrThrow(firmId: string | null) {
    const id = firmId ? numericId(firmId) : numericId((await this.sampleFirmId()) ?? "");
    if (id === null) throw new Error("The sample firm is not seeded yet (scripts/seed.ts).");
    return id;
  }

  async insertPlan(plan: PaymentPlan) {
    const values = {
      claimId: plan.claimId,
      route: plan.route,
      amount: toValue(plan.amountCents),
      currency: plan.currency,
      approval: plan.approval ? (plan.approval.by === "auto_rule" ? "auto" : "reviewer") : null,
      approvedBy: plan.approval?.who ?? null,
      approvedAt: plan.approval ? new Date(plan.approval.at) : null,
      status: PLAN_TO_DB[plan.status],
      detail: planDetail(plan),
    };
    const [row] = await db().insert(P).values(values).onConflictDoNothing().returning();
    if (row) return { plan: toPlan(row), created: true };
    // One plan per claim. A canceled plan is replaced in place, since claim_id is unique.
    const [reset] = await db()
      .update(P)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(P.claimId, plan.claimId), sql`${planStatusSql} = 'canceled'`))
      .returning();
    if (reset) return { plan: toPlan(reset), created: true };
    const [existing] = await db().select().from(P).where(eq(P.claimId, plan.claimId)).limit(1);
    return { plan: toPlan(existing), created: false };
  }

  async getPlan(id: string) {
    const n = numericId(id);
    if (n === null) return null;
    const [r] = await db().select().from(P).where(eq(P.id, n)).limit(1);
    return r ? toPlan(r) : null;
  }

  async getPlanByClaim(claimId: string) {
    const [r] = await db().select().from(P).where(eq(P.claimId, claimId)).limit(1);
    return r ? toPlan(r) : null;
  }

  async transitionPlan(id: string, from: PlanStatus[], to: PlanStatus, patch: Partial<Pick<PaymentPlan, "approval" | "attempt">> = {}) {
    const n = numericId(id);
    if (n === null || from.length === 0) return null;
    const detailPatch: Record<string, unknown> = { status: to };
    if (patch.attempt !== undefined) detailPatch.attempt = patch.attempt;
    if (patch.approval) detailPatch.approvalRule = patch.approval.rule ?? null;
    const set: Partial<typeof P.$inferInsert> & { detail: SQL } = { status: PLAN_TO_DB[to], detail: sql`${P.detail} || ${JSON.stringify(detailPatch)}::jsonb`, updatedAt: new Date() };
    if (patch.approval) {
      set.approval = patch.approval.by === "auto_rule" ? "auto" : "reviewer";
      set.approvedBy = patch.approval.who;
      set.approvedAt = new Date(patch.approval.at);
    }
    // The compare-and-set: one UPDATE, guarded by the current status, so only one caller wins.
    const [r] = await db()
      .update(P)
      .set(set)
      .where(and(eq(P.id, n), inArray(planStatusSql, from)))
      .returning();
    return r ? toPlan(r) : null;
  }

  private selectPayments() {
    return db().select({ p: Pay, firmId: C.firmId }).from(Pay).leftJoin(C, eq(C.id, Pay.claimId));
  }

  async insertPayment(p: PaymentRecord) {
    const planId = numericId(p.planId);
    if (planId === null) throw new Error("Payment plan ids are numbers in Postgres.");
    const [row] = await db()
      .insert(Pay)
      .values({ planId, claimId: p.claimId, route: p.route, amount: toValue(p.amountCents), currency: p.currency, requestId: p.requestId, ...paymentColumns(p, p.route) })
      .onConflictDoNothing()
      .returning({ id: Pay.id });
    const [got] = await this.selectPayments()
      .where(row ? eq(Pay.id, row.id) : eq(Pay.requestId, p.requestId))
      .limit(1);
    return { payment: toPayment(got.p, got.firmId), created: Boolean(row) };
  }

  async getPayment(id: string) {
    const n = numericId(id);
    if (n === null) return null;
    const [r] = await this.selectPayments().where(eq(Pay.id, n)).limit(1);
    return r ? toPayment(r.p, r.firmId) : null;
  }

  async getPaymentByClaim(claimId: string) {
    const [r] = await this.selectPayments().where(eq(Pay.claimId, claimId)).orderBy(desc(Pay.id)).limit(1);
    return r ? toPayment(r.p, r.firmId) : null;
  }

  async getPaymentByPlan(planId: string, attempt: number) {
    const n = numericId(planId);
    if (n === null) return null;
    const rows = await this.selectPayments().where(eq(Pay.planId, n)).orderBy(desc(Pay.id));
    const r = rows.map((x) => toPayment(x.p, x.firmId)).find((x) => x.attempt === attempt);
    return r ?? null;
  }

  async findPayments(q: PaymentQuery) {
    const w: SQL[] = [];
    if (q.claimId !== undefined) w.push(eq(Pay.claimId, q.claimId));
    if (q.payoutBatchId !== undefined) w.push(eq(Pay.paypalBatchId, q.payoutBatchId));
    if (q.payoutItemId !== undefined) w.push(eq(Pay.paypalItemId, q.payoutItemId));
    if (q.senderBatchId !== undefined) w.push(eq(Pay.senderBatchId, q.senderBatchId));
    if (q.senderItemId !== undefined) w.push(eq(Pay.senderItemId, q.senderItemId));
    if (q.captureId !== undefined) w.push(eq(Pay.paypalCaptureId, q.captureId));
    if (q.refundId !== undefined) w.push(eq(Pay.paypalRefundId, q.refundId));
    if (q.orderId !== undefined) w.push(eq(Pay.paypalOrderId, q.orderId));
    if (q.statuses !== undefined) w.push(inArray(Pay.status, payStatusesToDb(q.statuses)));
    const rows = await this.selectPayments()
      .where(w.length ? and(...w) : undefined)
      .orderBy(Pay.id)
      .limit(1000);
    return rows.map((r) => toPayment(r.p, r.firmId));
  }

  async updatePayment(id: string, patch: Partial<PaymentRecord>) {
    const n = numericId(id);
    if (n === null) return null;
    const [cur] = await db().select({ route: Pay.route }).from(Pay).where(eq(Pay.id, n)).limit(1);
    if (!cur) return null;
    const cols = paymentColumns(patch, cur.route as PaymentRoute);
    if (Object.keys(cols).length) await db().update(Pay).set({ ...cols, updatedAt: new Date() }).where(eq(Pay.id, n));
    return this.getPayment(id);
  }

  async sumPaymentsSince(since: Date) {
    const [r] = await db()
      .select({ total: sql<string>`coalesce(sum(${Pay.amount}), 0)` })
      .from(Pay)
      // Seeded sample history (paypal_status SAMPLE) never moved money, so it does not count toward the daily cap.
      .where(and(gte(Pay.createdAt, since), notInArray(Pay.status, ["failed", "canceled"]), sql`coalesce(${Pay.paypalStatus}, '') <> 'SAMPLE'`));
    return toCents(r?.total ?? 0);
  }

  async insertSale(s: Sale) {
    const firmId = await this.firmOrThrow(s.firmId);
    const [row] = await db()
      .insert(S)
      .values({
        firmId,
        source: s.source,
        buyerEmailHash: s.buyerEmailHash,
        itemName: s.itemName,
        sku: s.sku,
        amount: toValue(s.amountCents),
        currency: "USD",
        paidAt: new Date(s.paidAt),
        paypalOrderId: s.paypalOrderId,
        paypalCaptureId: s.paypalCaptureId,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return { sale: toSale(row), created: true };
    const existing = s.paypalCaptureId ? await this.getSaleByCapture(s.paypalCaptureId) : null;
    if (!existing) throw new Error("Could not record the sale.");
    return { sale: existing, created: false };
  }

  async getSaleByCapture(captureId: string) {
    const [r] = await db().select().from(S).where(eq(S.paypalCaptureId, captureId)).limit(1);
    return r ? toSale(r) : null;
  }

  async getSaleByOrder(orderId: string) {
    const [r] = await db().select().from(S).where(eq(S.paypalOrderId, orderId)).limit(1);
    return r ? toSale(r) : null;
  }

  async findSalesByBuyerHash(hash: string) {
    return (await db().select().from(S).where(eq(S.buyerEmailHash, hash)).orderBy(desc(S.paidAt))).map(toSale);
  }

  async recordWebhookEvent(e: WebhookEventRecord) {
    const resourceType = ((e.payload ?? {}) as { resource_type?: string }).resource_type ?? null;
    const rows = await db()
      .insert(W)
      .values({ provider: "paypal", eventId: e.eventId, eventType: e.eventType, resourceType, resourceId: e.resourceId, verified: e.trusted, payload: e.payload ?? {}, receivedAt: new Date(e.receivedAt) })
      .onConflictDoUpdate({
        target: [W.provider, W.eventId],
        set: { verified: true, payload: e.payload ?? {}, error: null, processedAt: null },
        // Only an untrusted row is upgraded, and only by a trusted copy.
        setWhere: sql`${W.verified} = false and excluded.verified = true`,
      })
      .returning({ id: W.id });
    return { created: rows.length > 0 };
  }

  async finishWebhookEvent(eventId: string, result: string) {
    const problem = result.startsWith("error:") || result === "ignored_untrusted";
    await db()
      .update(W)
      .set({ processedAt: new Date(), error: problem ? result : null })
      .where(and(eq(W.provider, "paypal"), eq(W.eventId, eventId)));
  }

  async getWebhookEvent(eventId: string) {
    const [r] = await db()
      .select()
      .from(W)
      .where(and(eq(W.provider, "paypal"), eq(W.eventId, eventId)))
      .limit(1);
    if (!r) return null;
    return {
      eventId: r.eventId,
      eventType: r.eventType,
      resourceId: r.resourceId,
      trusted: r.verified,
      payload: r.payload,
      result: r.processedAt ? (r.error ?? "processed") : null,
      receivedAt: r.receivedAt.toISOString(),
    } satisfies WebhookEventRecord;
  }

  async addPlanTask(t: PlanTaskRecord) {
    const firmId = await this.firmOrThrow(t.firmId);
    return db().transaction(async (tx) => {
      // plan_task.ref is not unique, so serialize adds per ref and check first.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${t.key}))`);
      const [have] = await tx.select({ id: T.id }).from(T).where(eq(T.ref, t.key)).limit(1);
      if (have) return { created: false };
      let dependencies: PlanDependency[] = [];
      if (t.dependsOn) {
        const [from] = await tx.select({ id: T.id }).from(T).where(eq(T.ref, t.dependsOn)).limit(1);
        if (from) dependencies = [{ from: from.id, type: 2 }]; // Bryntum type 2: finish to start.
      }
      const start = new Date(`${t.startDate}T00:00:00Z`);
      await tx.insert(T).values({
        firmId,
        // Only a recall the database knows (the column is a foreign key).
        recallNumber: t.recallNumber ? sql`(select number from recall where number = ${t.recallNumber})` : null,
        name: t.name,
        kind: t.kind,
        startDate: start,
        endDate: new Date(start.getTime() + t.durationDays * DAY),
        duration: String(t.durationDays),
        durationUnit: "day",
        dependencies,
        source: t.source,
        ref: t.key,
        data: { ...t.data, dependsOn: t.dependsOn },
      });
      return { created: true };
    });
  }

  async listPlanTasks(q: { kind?: PlanTaskRecord["kind"]; recallNumber?: string } = {}) {
    const w: SQL[] = [];
    if (q.kind) w.push(eq(T.kind, q.kind));
    if (q.recallNumber) w.push(eq(T.recallNumber, q.recallNumber));
    const rows = await db()
      .select()
      .from(T)
      .where(w.length ? and(...w) : undefined)
      .orderBy(T.startDate, T.id);
    return rows.map(toTask);
  }
}
