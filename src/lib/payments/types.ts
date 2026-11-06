/**
 * Shared types for Remedy's payments engine. Every amount crosses a module boundary as whole cents, so the money math
 * is exact; PayPal's "34.99" strings are made only at the request edge.
 */

export type PayeeType = "email" | "phone" | "venmo";
export type Payee = { type: PayeeType; value: string };

export type PaymentRoute = "refund" | "payout" | "replacement";

/** A plan waits for approval, is approved (by the firm's auto rule or a reviewer), then runs once. */
export type PlanStatus = "awaiting_approval" | "approved" | "executing" | "submitted" | "paid" | "failed" | "canceled";

/** Remedy's own payment status, the same words for every route. `status.ts` maps PayPal's statuses onto these. */
export type PaymentStatus = "sending" | "paid" | "unclaimed" | "returned" | "failed" | "blocked" | "on_hold" | "canceled" | "reversed";

export type Approval = {
  by: "auto_rule" | "reviewer";
  /** "auto rule" or the reviewer's name. */
  who: string;
  rule?: string;
  at: string;
};

/** A safe replacement chosen by the owner (from Channel3), paid to a retailer stand-in in the sandbox. */
export type Replacement = {
  productId: string;
  title: string;
  priceCents: number;
  retailer: string;
  url?: string | null;
  /** Set by the caller after the Elastic check: no active recall matches this product. */
  noActiveRecall: boolean;
};

export type PaymentPlan = {
  id: string;
  claimId: string;
  firmId: string | null;
  recallNumber: string;
  recallTitle: string;
  route: PaymentRoute;
  amountCents: number;
  currency: "USD";
  payee: Payee | null;
  captureId: string | null;
  replacement: Replacement | null;
  reasons: { plain: string; technical: string };
  approval: Approval | null;
  status: PlanStatus;
  /** Starts at 1. A retry after a definite failure starts a new attempt with a new idempotency key. */
  attempt: number;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRecord = {
  id: string;
  planId: string;
  claimId: string;
  /** The plan attempt this payment belongs to; one payment per attempt. */
  attempt: number;
  /** Unique per payment: refund-<claim>-a<n> and replace-<claim>-a<n> are the PayPal-Request-Id; payout-<claim>-a<n> names the item. */
  requestId: string;
  firmId: string | null;
  route: PaymentRoute;
  amountCents: number;
  currency: "USD";
  status: PaymentStatus;
  /** PayPal's own status word, kept for Technical view. */
  paypalStatus: string | null;
  payeeType: PayeeType | null;
  senderBatchId: string | null;
  senderItemId: string | null;
  payoutBatchId: string | null;
  payoutItemId: string | null;
  transactionId: string | null;
  captureId: string | null;
  refundId: string | null;
  orderId: string | null;
  debugId: string | null;
  /** A PayPal issue code when something went wrong, for example RECEIVER_UNREGISTERED. Never personal data. */
  issue: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Sale = {
  id: string;
  firmId: string | null;
  /** shop: the sample shop's Orders v2 sale; paypal: found with Transaction Search; csv: a firm's sales file. */
  source: "shop" | "paypal" | "csv";
  buyerEmailHash: string | null;
  itemName: string;
  sku: string | null;
  amountCents: number;
  paidAt: string;
  paypalCaptureId: string | null;
  paypalOrderId: string | null;
};

export type WebhookEventRecord = {
  eventId: string;
  eventType: string;
  resourceId: string | null;
  trusted: boolean;
  /** How the event was checked: PayPal's signature API, a lookup of PayPal's own copy, or not at all. Also in the ledger. */
  verification?: "signature" | "lookup" | "none";
  payload: unknown;
  result: string | null;
  receivedAt: string;
};

/** A task the corrective-action plan (Bryntum Gantt) shows. `key` makes each one idempotent. */
export type PlanTaskRecord = {
  key: string;
  firmId: string | null;
  recallNumber: string | null;
  /** plan_task kinds the payments engine adds. */
  kind: "re_notice" | "payout_batch" | "follow_up";
  source: "webhook" | "system" | "person";
  name: string;
  startDate: string;
  durationDays: number;
  /** Key of the task this one depends on (finish to start), for example the payout batch. */
  dependsOn: string | null;
  data: Record<string, unknown>;
};

export type Actor = "person" | "agent" | "system" | "webhook";
/** The hash-chained ledger (`@/lib/audit`), injected so tests run without a database. */
export type Ledger = (actor: Actor, action: string, ref: string, detail?: Record<string, unknown>) => Promise<unknown>;

/** PayPal REST access with the shape of `paypalRest` in `@/lib/paypal/client`, injected so tests run offline. */
export type Rest = <T>(path: string, init?: RequestInit & { requestId?: string }) => Promise<{ status: number; body: T; debugId: string | null }>;
