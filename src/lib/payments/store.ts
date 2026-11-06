import type { PaymentPlan, PaymentRecord, PaymentStatus, PlanStatus, PlanTaskRecord, Sale, WebhookEventRecord } from "./types";

/**
 * Everything the payments engine reads or writes, behind one interface. `MemoryStore` runs the unit tests with no
 * database; `PgStore` (pg-store.ts) uses the shell's tables: payment_plan, payment, sale, webhook_event, plan_task.
 *
 * Idempotency lives here, not in callers:
 * - one current plan per claim (`insertPlan` returns the existing plan on a second call);
 * - `transitionPlan` is a compare-and-set, so only one caller can move a plan from approved to executing;
 * - one payment per plan attempt; one sale per PayPal capture; one webhook row per PayPal event id;
 *   one plan task per key.
 */
export interface PaymentStore {
  insertPlan(plan: PaymentPlan): Promise<{ plan: PaymentPlan; created: boolean }>;
  getPlan(id: string): Promise<PaymentPlan | null>;
  getPlanByClaim(claimId: string): Promise<PaymentPlan | null>;
  /** Move a plan to `to` only if its status is one of `from`. Returns the updated plan, or null if another call got there first. */
  transitionPlan(id: string, from: PlanStatus[], to: PlanStatus, patch?: Partial<Pick<PaymentPlan, "approval" | "attempt">>): Promise<PaymentPlan | null>;

  insertPayment(p: PaymentRecord): Promise<{ payment: PaymentRecord; created: boolean }>;
  getPayment(id: string): Promise<PaymentRecord | null>;
  /** The latest payment for a claim. */
  getPaymentByClaim(claimId: string): Promise<PaymentRecord | null>;
  getPaymentByPlan(planId: string, attempt: number): Promise<PaymentRecord | null>;
  findPayments(q: PaymentQuery): Promise<PaymentRecord[]>;
  updatePayment(id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord | null>;
  /** Total of payments created since `since` that are not failed or canceled, in cents. */
  sumPaymentsSince(since: Date): Promise<number>;

  insertSale(s: Sale): Promise<{ sale: Sale; created: boolean }>;
  getSaleByCapture(captureId: string): Promise<Sale | null>;
  getSaleByOrder(orderId: string): Promise<Sale | null>;
  findSalesByBuyerHash(hash: string): Promise<Sale[]>;

  /** False when this event id is already stored (a retry). An untrusted row is replaced by a trusted one. */
  recordWebhookEvent(e: WebhookEventRecord): Promise<{ created: boolean }>;
  finishWebhookEvent(eventId: string, result: string): Promise<void>;
  getWebhookEvent(eventId: string): Promise<WebhookEventRecord | null>;

  addPlanTask(t: PlanTaskRecord): Promise<{ created: boolean }>;
  listPlanTasks(q?: { kind?: PlanTaskRecord["kind"]; recallNumber?: string }): Promise<PlanTaskRecord[]>;
}

export type PaymentQuery = {
  claimId?: string;
  payoutBatchId?: string;
  payoutItemId?: string;
  senderBatchId?: string;
  senderItemId?: string;
  captureId?: string;
  refundId?: string;
  orderId?: string;
  statuses?: PaymentStatus[];
};

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements PaymentStore {
  plans = new Map<string, PaymentPlan>();
  payments = new Map<string, PaymentRecord>();
  sales = new Map<string, Sale>();
  events = new Map<string, WebhookEventRecord>();
  tasks = new Map<string, PlanTaskRecord>();

  async insertPlan(plan: PaymentPlan) {
    const existing = [...this.plans.values()].find((p) => p.claimId === plan.claimId && p.status !== "canceled");
    if (existing) return { plan: clone(existing), created: false };
    this.plans.set(plan.id, clone(plan));
    return { plan: clone(plan), created: true };
  }
  async getPlan(id: string) {
    const p = this.plans.get(id);
    return p ? clone(p) : null;
  }
  async getPlanByClaim(claimId: string) {
    const all = [...this.plans.values()].filter((p) => p.claimId === claimId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const current = all.find((p) => p.status !== "canceled") ?? all[0];
    return current ? clone(current) : null;
  }
  async transitionPlan(id: string, from: PlanStatus[], to: PlanStatus, patch: Partial<Pick<PaymentPlan, "approval" | "attempt">> = {}) {
    // No await between the read and the write: this is the compare-and-set that keeps a second "pay" from running.
    const p = this.plans.get(id);
    if (!p || !from.includes(p.status)) return null;
    const next = { ...p, ...patch, status: to, updatedAt: new Date().toISOString() };
    this.plans.set(id, next);
    return clone(next);
  }

  async insertPayment(p: PaymentRecord) {
    const existing = [...this.payments.values()].find((x) => x.requestId === p.requestId || (x.planId === p.planId && x.attempt === p.attempt));
    if (existing) return { payment: clone(existing), created: false };
    this.payments.set(p.id, clone(p));
    return { payment: clone(p), created: true };
  }
  async getPayment(id: string) {
    const p = this.payments.get(id);
    return p ? clone(p) : null;
  }
  async getPaymentByClaim(claimId: string) {
    const all = [...this.payments.values()].filter((p) => p.claimId === claimId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return all[0] ? clone(all[0]) : null;
  }
  async getPaymentByPlan(planId: string, attempt: number) {
    const p = [...this.payments.values()].find((x) => x.planId === planId && x.attempt === attempt);
    return p ? clone(p) : null;
  }
  async findPayments(q: PaymentQuery) {
    return [...this.payments.values()]
      .filter(
        (p) =>
          (q.claimId === undefined || p.claimId === q.claimId) &&
          (q.payoutBatchId === undefined || p.payoutBatchId === q.payoutBatchId) &&
          (q.payoutItemId === undefined || p.payoutItemId === q.payoutItemId) &&
          (q.senderBatchId === undefined || p.senderBatchId === q.senderBatchId) &&
          (q.senderItemId === undefined || p.senderItemId === q.senderItemId) &&
          (q.captureId === undefined || p.captureId === q.captureId) &&
          (q.refundId === undefined || p.refundId === q.refundId) &&
          (q.orderId === undefined || p.orderId === q.orderId) &&
          (q.statuses === undefined || q.statuses.includes(p.status)),
      )
      .map(clone);
  }
  async updatePayment(id: string, patch: Partial<PaymentRecord>) {
    const p = this.payments.get(id);
    if (!p) return null;
    const next = { ...p, ...patch, id: p.id, updatedAt: new Date().toISOString() };
    this.payments.set(id, next);
    return clone(next);
  }
  async sumPaymentsSince(since: Date) {
    return [...this.payments.values()].filter((p) => p.createdAt >= since.toISOString() && p.status !== "failed" && p.status !== "canceled").reduce((s, p) => s + p.amountCents, 0);
  }

  async insertSale(s: Sale) {
    const existing = s.paypalCaptureId ? [...this.sales.values()].find((x) => x.paypalCaptureId === s.paypalCaptureId) : undefined;
    if (existing) return { sale: clone(existing), created: false };
    this.sales.set(s.id, clone(s));
    return { sale: clone(s), created: true };
  }
  async getSaleByCapture(captureId: string) {
    const s = [...this.sales.values()].find((x) => x.paypalCaptureId === captureId);
    return s ? clone(s) : null;
  }
  async getSaleByOrder(orderId: string) {
    const s = [...this.sales.values()].find((x) => x.paypalOrderId === orderId);
    return s ? clone(s) : null;
  }
  async findSalesByBuyerHash(hash: string) {
    return [...this.sales.values()].filter((s) => s.buyerEmailHash === hash).map(clone);
  }

  async recordWebhookEvent(e: WebhookEventRecord) {
    const existing = this.events.get(e.eventId);
    // An event first seen untrusted (say, posted before it could be looked up) is replaced when it arrives trusted.
    if (existing && (existing.trusted || !e.trusted)) return { created: false };
    this.events.set(e.eventId, clone(e));
    return { created: true };
  }
  async finishWebhookEvent(eventId: string, result: string) {
    const e = this.events.get(eventId);
    if (e) this.events.set(eventId, { ...e, result });
  }
  async getWebhookEvent(eventId: string) {
    const e = this.events.get(eventId);
    return e ? clone(e) : null;
  }

  async addPlanTask(t: PlanTaskRecord) {
    if (this.tasks.has(t.key)) return { created: false };
    this.tasks.set(t.key, clone(t));
    return { created: true };
  }
  async listPlanTasks(q: { kind?: PlanTaskRecord["kind"]; recallNumber?: string } = {}) {
    return [...this.tasks.values()].filter((t) => (q.kind === undefined || t.kind === q.kind) && (q.recallNumber === undefined || t.recallNumber === q.recallNumber)).map(clone);
  }
}

export const paymentIdFor = (planId: string, attempt: number) => `pay_${planId}_a${attempt}`;
