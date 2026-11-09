/**
 * Remedy's tables (plan section 8). db/schema.sql is the reviewed SQL for the same tables and is what gets applied;
 * tests/schema.test.ts keeps the two in step. Money is numeric(10,2), which Drizzle reads as a string ("34.99").
 * Personal data never sits here in the clear: contact details are encrypted (`*_enc`, src/lib/secure.ts) or hashed
 * (`*_hash`), and the claims grid shows a masked form.
 */
import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigserial, boolean, customType, date, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const money = (name: string) => numeric(name, { precision: 10, scale: 2 });
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------------------------------------------
// Recalls and their proof rules (public CPSC data)
// ---------------------------------------------------------------------------------------------------------------

export type RecallProduct = { name: string; model: string; description: string; type: string; units: string };
export type RecallImage = { url: string; caption: string };
export type RecallFlags = { photo: boolean; refund: boolean; marker: boolean; cut: boolean; email: boolean; webmail: boolean };

/** One CPSC recall, keyed by its recall number ("26055"). Loaded from content/recalls/recalls.json. */
export const recalls = pgTable(
  "recall",
  {
    number: text("number").primaryKey(),
    title: text("title").notNull(),
    date: date("date").notNull(),
    /** Units as a number when the recall states one ("About 12,400" reads as 12400); the words stay in unitsText. */
    units: integer("units"),
    unitsText: text("units_text").notNull().default(""),
    hazard: text("hazard").notNull().default(""),
    remedyText: text("remedy_text").notNull().default(""),
    remedies: jsonb("remedies").$type<string[]>().notNull().default([]),
    products: jsonb("products").$type<RecallProduct[]>().notNull().default([]),
    images: jsonb("images").$type<RecallImage[]>().notNull().default([]),
    retailers: jsonb("retailers").$type<string[]>().notNull().default([]),
    manufacturers: jsonb("manufacturers").$type<string[]>().notNull().default([]),
    consumerContact: text("consumer_contact").notNull().default(""),
    url: text("url").notNull().default(""),
    photoRefund: boolean("photo_refund").notNull().default(false),
    flags: jsonb("flags").$type<RecallFlags>().notNull().default({ photo: false, refund: false, marker: false, cut: false, email: false, webmail: false }),
    /** The CPSC API record as it came, for the Technical view. */
    raw: jsonb("raw"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("recall_date_idx").on(t.date), index("recall_photo_refund_idx").on(t.photoRefund)],
);

/**
 * A recall's proof rule (plan 7.1): what the owner must do and what the photo must show. Each edit is a new version;
 * the highest version is the one in force. source: ai (extracted), firm (edited by the firm), baseline (regex).
 */
export const proofRules = pgTable(
  "proof_rule",
  {
    id: serial("id").primaryKey(),
    recallNumber: text("recall_number")
      .notNull()
      .references(() => recalls.number, { onDelete: "cascade" }),
    rule: jsonb("rule").notNull(),
    source: text("source").notNull().default("ai"),
    model: text("model"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: created(),
  },
  (t) => [uniqueIndex("proof_rule_recall_version_idx").on(t.recallNumber, t.version)],
);

// ---------------------------------------------------------------------------------------------------------------
// Firms and their recalls
// ---------------------------------------------------------------------------------------------------------------

export type FirmSettings = { autoApproveCap?: number; dailyPayoutCap?: number; reviewHours?: number; replyName?: string };

/** A recalling firm. Brightline Home (is_sample) is the fictional sample firm; payouts run from the sandbox. */
export const firms = pgTable(
  "firm",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    contactEmail: text("contact_email").notNull().default(""),
    /** The firm's own sandbox REST app, encrypted. Null: payouts use this server's sandbox app. */
    paypalClientIdEnc: text("paypal_client_id_enc"),
    paypalSecretEnc: text("paypal_secret_enc"),
    settings: jsonb("settings").$type<FirmSettings>().notNull().default({}),
    /** starter | pro. PayPal Subscriptions sets pro on BILLING.SUBSCRIPTION.ACTIVATED. */
    plan: text("plan").notNull().default("starter"),
    paypalSubscriptionId: text("paypal_subscription_id"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("firm_slug_idx").on(t.slug)],
);

/** A recall a firm is running: its refund per model and the caps that decide auto-approval. */
export const firmRecalls = pgTable(
  "firm_recall",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    recallNumber: text("recall_number")
      .notNull()
      .references(() => recalls.number),
    /** { "<model>": "34.99" }; a model not listed uses defaultRefund. */
    refundByModel: jsonb("refund_by_model").$type<Record<string, string>>().notNull().default({}),
    defaultRefund: money("default_refund"),
    /** Claims at or under this amount that pass every check are paid without a person. */
    autoCap: money("auto_cap").notNull().default("50.00"),
    /** The most this recall pays out in one day. */
    dailyCap: money("daily_cap").notNull().default("2500.00"),
    /** active | paused | closed */
    status: text("status").notNull().default("active"),
    announcedOn: date("announced_on"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("firm_recall_firm_recall_idx").on(t.firmId, t.recallNumber)],
);

/** A sale of a recalled product: from a firm's CSV, PayPal Transaction Search, or the sample shop (Orders v2). */
export const sales = pgTable(
  "sale",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    recallNumber: text("recall_number").references(() => recalls.number),
    /** csv | paypal | shop */
    source: text("source").notNull(),
    buyerEmailHash: text("buyer_email_hash"),
    buyerContactEnc: text("buyer_contact_enc"),
    itemName: text("item_name").notNull(),
    sku: text("sku"),
    quantity: integer("quantity").notNull().default(1),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paypalOrderId: text("paypal_order_id"),
    paypalCaptureId: text("paypal_capture_id"),
    createdAt: created(),
  },
  (t) => [
    index("sale_firm_idx").on(t.firmId),
    index("sale_buyer_idx").on(t.buyerEmailHash),
    uniqueIndex("sale_capture_idx")
      .on(t.paypalCaptureId)
      .where(sql`${t.paypalCaptureId} is not null`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Claims: the photo, the checks, the decision
// ---------------------------------------------------------------------------------------------------------------

/** An uploaded photo. The bytes live here (small JPEG or WebP after resizing) or at storage_path. */
export const photos = pgTable(
  "photo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sha256: text("sha256").notNull(),
    /** 64-bit difference hash as 16 hex characters (C3). */
    dhash: text("dhash"),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: bytea("bytes"),
    storagePath: text("storage_path"),
    /** The owner's untouched upload, kept only until the checks ran on it (src/app/api/claims/_lib/claims.ts). */
    original: bytea("original"),
    /** upload | preset | email */
    source: text("source").notNull().default("upload"),
    createdAt: created(),
    /** When the bytes were deleted: at once for a photo that shows a person, 90 days after the decision otherwise. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /** person | retention */
    removedReason: text("removed_reason"),
  },
  (t) => [index("photo_sha256_idx").on(t.sha256), index("photo_dhash_idx").on(t.dhash)],
);

/**
 * One owner's claim. decision is the verification engine's verdict (pending | verified | retake | firm_review);
 * status is where the claim stands overall, for the queue's views:
 * checking | verified | retake | firm_review | approved | paid | unclaimed | closed.
 */
export const claims = pgTable(
  "claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recallNumber: text("recall_number")
      .notNull()
      .references(() => recalls.number),
    firmId: integer("firm_id").references(() => firms.id),
    photoId: uuid("photo_id").references(() => photos.id),
    /** email | phone | venmo */
    payeeType: text("payee_type"),
    payeeValueEnc: text("payee_value_enc"),
    /** Salted hash of the payee, for C5 (claims per payee) without decrypting. */
    payeeHash: text("payee_hash"),
    /** For the claims grid: "j•••@example.com". */
    payeeMasked: text("payee_masked"),
    linkedSaleId: integer("linked_sale_id").references(() => sales.id),
    /** Keyed hash of the claimant's network address and browser, one of the identities the claim limit counts. */
    visitorHash: text("visitor_hash"),
    unitsClaimed: integer("units_claimed").notNull().default(1),
    checks: jsonb("checks").notNull().default({}),
    decision: text("decision").notNull().default("pending"),
    status: text("status").notNull().default("checking"),
    /** The two reviewers and the referee, for firm_review cases. */
    debate: jsonb("debate"),
    /** The rest of the verifier's answer beside the six checks: decided_by, guidance, summary, quality, timings, model. */
    result: jsonb("result"),
    amount: money("amount"),
    /** web | link | email | api | preset */
    channel: text("channel").notNull().default("web"),
    /** approved | retake | declined, set by a person at the firm. */
    reviewOutcome: text("review_outcome"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    isSample: boolean("is_sample").notNull().default(false),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("claim_recall_idx").on(t.recallNumber),
    index("claim_firm_status_idx").on(t.firmId, t.status),
    index("claim_payee_idx").on(t.payeeHash, t.recallNumber),
    index("claim_decided_idx").on(t.decidedAt),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------------------------------------------

/**
 * How a claim will be paid (plan 7.3), approved by the firm's auto-rule or a reviewer. One plan per claim, so a
 * second "pay" finds the first plan and never pays twice.
 * route: refund | payout | replacement. status: planned | approved | executing | done | failed | canceled.
 */
export const paymentPlans = pgTable(
  "payment_plan",
  {
    id: serial("id").primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** auto | reviewer */
    approval: text("approval"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    status: text("status").notNull().default("planned"),
    /** Route details: the capture to refund, the payout recipient type, the replacement product. */
    detail: jsonb("detail").notNull().default({}),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("payment_plan_claim_idx").on(t.claimId)],
);

/**
 * One money movement at PayPal: a payout item, a refund of a capture, or a replacement order.
 * status is Remedy's (pending | success | unclaimed | returned | failed | blocked | onhold | refunded | reversed |
 * canceled); paypal_status is PayPal's own word for it.
 */
export const payments = pgTable(
  "payment",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => paymentPlans.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("pending"),
    paypalStatus: text("paypal_status"),
    senderBatchId: text("sender_batch_id"),
    senderItemId: text("sender_item_id"),
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id"),
    paypalTransactionId: text("paypal_transaction_id"),
    paypalRefundId: text("paypal_refund_id"),
    paypalOrderId: text("paypal_order_id"),
    paypalCaptureId: text("paypal_capture_id"),
    /** EMAIL | PHONE, and PAYPAL | VENMO */
    recipientType: text("recipient_type"),
    recipientWallet: text("recipient_wallet"),
    /** PayPal-Request-Id: the same request is never sent twice. */
    requestId: text("request_id"),
    debugId: text("debug_id"),
    error: jsonb("error"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("payment_claim_idx").on(t.claimId),
    index("payment_batch_idx").on(t.paypalBatchId),
    uniqueIndex("payment_request_idx")
      .on(t.requestId)
      .where(sql`${t.requestId} is not null`),
    uniqueIndex("payment_item_idx")
      .on(t.paypalItemId)
      .where(sql`${t.paypalItemId} is not null`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// The firm's loop: notices, the corrective-action plan, monthly reports
// ---------------------------------------------------------------------------------------------------------------

/** A notice to a buyer with a personal claim link (only the link token's hash is stored). kind: notice | re_notice. */
export const notices = pgTable(
  "notice",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    recallNumber: text("recall_number").references(() => recalls.number),
    saleId: integer("sale_id").references(() => sales.id),
    claimId: uuid("claim_id").references(() => claims.id),
    kind: text("kind").notNull().default("notice"),
    /** email | sms | qr | letter */
    channel: text("channel").notNull(),
    recipientHash: text("recipient_hash"),
    claimLinkTokenHash: text("claim_link_token_hash"),
    /** queued | sent | failed | opened | claimed */
    status: text("status").notNull().default("queued"),
    provider: text("provider"),
    providerId: text("provider_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index("notice_firm_idx").on(t.firmId, t.recallNumber),
    uniqueIndex("notice_token_idx")
      .on(t.claimLinkTokenHash)
      .where(sql`${t.claimLinkTokenHash} is not null`),
  ],
);

export type PlanDependency = { from: number; type?: number; lag?: number; lagUnit?: string };

/**
 * One task in a recall's corrective-action plan, in the shape Bryntum Gantt's CrudManager reads. kind: announcement |
 * notice_wave | report | payout_batch | follow_up | re_notice | milestone | other. dependencies lists this task's
 * predecessors. source says who added it: seed | person | webhook | system. ref ties it to what it is about (a
 * payout batch id, a report month).
 */
export const planTasks = pgTable(
  "plan_task",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    recallNumber: text("recall_number").references(() => recalls.number),
    parentId: integer("parent_id").references((): AnyPgColumn => planTasks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("other"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    duration: numeric("duration", { precision: 8, scale: 2 }),
    durationUnit: text("duration_unit").notNull().default("day"),
    percentDone: numeric("percent_done", { precision: 5, scale: 2 }).notNull().default("0"),
    orderIndex: integer("order_index").notNull().default(0),
    dependencies: jsonb("dependencies").$type<PlanDependency[]>().notNull().default([]),
    source: text("source").notNull().default("seed"),
    ref: text("ref"),
    data: jsonb("data").notNull().default({}),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("plan_task_firm_idx").on(t.firmId, t.recallNumber), index("plan_task_ref_idx").on(t.ref)],
);

/** A monthly progress report for one recall. numbers come from SQL; the narrative is written from them. */
export const reports = pgTable(
  "report",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    recallNumber: text("recall_number")
      .notNull()
      .references(() => recalls.number),
    /** YYYY-MM */
    month: text("month").notNull(),
    numbers: jsonb("numbers").notNull(),
    narrative: text("narrative"),
    narrativeModel: text("narrative_model"),
    pdf: bytea("pdf"),
    /** draft | final | sent */
    status: text("status").notNull().default("draft"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("report_firm_recall_month_idx").on(t.firmId, t.recallNumber, t.month)],
);

/**
 * Perceptual hashes for C3. source official: ref is the CPSC image URL. source claim: ref is the photo id. source partner:
 * a hash a connected firm registered through POST /api/v1/hash-pool/register; ref is the firm's own opaque id or a UUID,
 * and the key that registered it is not stored on the row.
 */
export const imageHashes = pgTable(
  "image_hash",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    ref: text("ref").notNull(),
    recallNumber: text("recall_number"),
    dhash: text("dhash").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("image_hash_source_ref_idx").on(t.source, t.ref), index("image_hash_recall_idx").on(t.recallNumber), index("image_hash_dhash_idx").on(t.dhash)],
);

// ---------------------------------------------------------------------------------------------------------------
// Platform: keys, usage, the audit ledger, integrations, webhooks
// ---------------------------------------------------------------------------------------------------------------

/** Developer API keys. Only the SHA-256 hash and a short display prefix are stored; the key is shown once. */
export const apiKeys = pgTable(
  "api_key",
  {
    id: serial("id").primaryKey(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    purpose: text("purpose").notNull().default(""),
    /** read | verify | payments:sandbox */
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["read", "verify", "payments:sandbox"]),
    /** Random id in an httpOnly cookie: the browser that created the key can see its usage. No passwords. */
    ownerId: text("owner_id").notNull(),
    createdIp: text("created_ip").notNull().default(""),
    createdAt: created(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_key_hash_idx").on(t.hash)],
);

/** One row per public API call: rate limits and the usage page read from here. */
export const apiUsage = pgTable(
  "api_usage",
  {
    id: serial("id").primaryKey(),
    keyId: integer("key_id").references(() => apiKeys.id),
    /** Hashed client IP for calls without a key (the demo tier). */
    client: text("client").notNull().default(""),
    endpoint: text("endpoint").notNull(),
    status: integer("status").notNull(),
    ms: integer("ms").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_usage_key_at_idx").on(t.keyId, t.at), index("api_usage_client_at_idx").on(t.client, t.at)],
);

/** One row per live Claude call, with its four token counts and computed cost (src/lib/ai/usage.ts). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Which feature made the call: verify.vision, verify.reviewer.product, recall.proof_rule, ... */
    route: text("route").notNull(),
    model: text("model").notNull(),
    effort: text("effort"),
    batch: boolean("batch").notNull().default(false),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    usd: numeric("usd", { precision: 12, scale: 6 }).notNull().default("0"),
  },
  (t) => [index("ai_usage_at_idx").on(t.at)],
);

/** A finished verification, so an identical photo for the same recall and rule costs no model call (src/lib/verify/cache.ts). */
export const verifyResults = pgTable(
  "verify_result",
  {
    key: text("key").primaryKey(),
    recallNumber: text("recall_number").notNull(),
    photoSha256: text("photo_sha256").notNull(),
    ruleVersion: text("rule_version").notNull(),
    engineVersion: text("engine_version").notNull(),
    decision: text("decision").notNull(),
    result: jsonb("result").notNull(),
    /** live | precomputed (demo presets, computed once with approval) */
    source: text("source").notNull().default("live"),
    hits: integer("hits").notNull().default(0),
    createdAt: created(),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
  },
  (t) => [index("verify_result_recall_idx").on(t.recallNumber)],
);

/** The hash-chained audit ledger (src/lib/audit.ts). Detail never holds raw personal data. */
export const auditEvents = pgTable("audit_event", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  ref: text("ref").notNull(),
  detail: jsonb("detail").notNull().default({}),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});

/** The last time each integration answered, for /stack and /status. mode: live | fallback | not_connected. */
export const integrationStatus = pgTable("integration_status", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  detail: text("detail").notNull().default(""),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastMs: integer("last_ms"),
  updatedAt: updated(),
});

/** Every inbound webhook, stored once by its event id. Unverified events are kept but never acted on. */
export const webhookEvents = pgTable(
  "webhook_event",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull().default("paypal"),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    verified: boolean("verified").notNull().default(false),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [uniqueIndex("webhook_event_provider_event_idx").on(t.provider, t.eventId), index("webhook_event_resource_idx").on(t.resourceId)],
);

/** Where Remedy sends signed events (claim.verified, claim.paid, payout.unclaimed), for a firm or an API key. */
export const outboundWebhooks = pgTable("outbound_webhook", {
  id: serial("id").primaryKey(),
  firmId: integer("firm_id").references(() => firms.id, { onDelete: "cascade" }),
  apiKeyId: integer("api_key_id").references(() => apiKeys.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  /** HMAC-SHA256 signing secret, shown to its owner once. */
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default(["claim.verified", "claim.paid", "payout.unclaimed"]),
  active: boolean("active").notNull().default(true),
  lastStatus: integer("last_status"),
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  failures: integer("failures").notNull().default(0),
  createdAt: created(),
});

// ---------------------------------------------------------------------------------------------------------------
// Operations: rate limits that hold across instances, the request log, the job queue
// ---------------------------------------------------------------------------------------------------------------

/** One row per (bucket, fixed window); the upsert in src/lib/ratelimit.ts returns the count. Pruned after a day. */
export const rateLimits = pgTable(
  "rate_limit",
  {
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowStart] }), index("rate_limit_window_idx").on(t.windowStart)],
);

/** One row per API request: route pattern, status, duration, request id. No addresses, bodies or keys. Kept 7 days. */
export const requestLog = pgTable(
  "request_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    requestId: text("request_id").notNull(),
    route: text("route").notNull(),
    status: integer("status").notNull(),
    ms: integer("ms").notNull(),
    created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("request_log_created_idx").on(t.created), index("request_log_request_idx").on(t.requestId)],
);

/** The job queue (src/lib/jobs). status: queued | running | done | failed (the dead letter, with last_error). */
export const jobs = pgTable(
  "job",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    /** Stage events the owner's page streams while the job runs. */
    progress: jsonb("progress").notNull().default([]),
    /** The handler's answer, for a route that waited on the job. */
    result: jsonb("result"),
    worker: text("worker"),
    created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
    updated: timestamp("updated", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_queue_idx").on(t.status, t.runAfter, t.id), index("job_created_idx").on(t.created)],
);
