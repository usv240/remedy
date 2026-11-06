/**
 * The owner's claim, end to end (plan 5.1 and 7.3): store the photo, run the checks, record the decision, and pay a
 * verified claim through the payments engine. The routes under /api/claims and the owner's pages call these; the
 * public API (/api/v1/claims) can too. Server only.
 *
 * Money, decisions and routes are code: verifyPhoto decides, planPayment routes, payClaim pays. The model only reports
 * what it sees in the photo.
 */
import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, inArray, ne } from "drizzle-orm";
import sharp from "sharp";
import { aiAvailable } from "@/lib/ai/claude";
import { overBudget, RESTING_PLAIN } from "@/lib/ai/usage";
import { audit } from "@/lib/audit";
import { findProducts, getProduct } from "@/lib/channel3";
import { db, dbConfigured, schema } from "@/lib/db";
import {
  LIMITS as PAY_LIMITS,
  SANDBOX_LABEL,
  approvePlan,
  maskPayee,
  paymentSummary,
  planPayment,
  priorRefundCheck,
  recipientFor,
  refreshPayment,
  refundWindow,
  salesForBuyer,
  toValue,
  type Payee,
  type Replacement,
} from "@/lib/payments";
import { candidateFromHit, heuristicMatch } from "@/lib/recall/match";
import { searchRecalls } from "@/lib/recall/search";
import { runJob } from "@/lib/jobs";
import { log } from "@/lib/log";
import { encrypt, hashContact, maskContact } from "@/lib/secure";
import { CHECK_IDS, verifyPhoto, type ClaimContext, type VerifyDeps, type VerifyResult } from "@/lib/verify";
import { defaultVerifyCache } from "@/lib/verify/cache";
import { allowUpload } from "@/lib/ratelimit";
import { runReviewers } from "@/lib/verify/reviewers";
import { runVision } from "@/lib/verify/vision";
import { getRecall, productName, ruleFor, verifyRecallFor } from "./recall";
import { replacementQuery } from "./recall-text";
import { DEMO_REFUND_CENTS, SHOP_RECALL, firmTerms, type FirmTerms } from "./terms";
import type { CheckView, ClaimEvent, ClaimStatus, ClaimView, LinkView, PaymentView, PayView, ReplacementOption } from "./types";

export type ApiCode = "invalid_request" | "not_found" | "rate_limited" | "upstream_unavailable" | "internal";
export class ClaimError extends Error {
  constructor(
    public code: ApiCode,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Photos up to 15 MB; a phone's camera JPEG is 2 to 6 MB. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
/** Stored copy for the receipt and the firm's queue: longest side 1600 px. */
const STORED_MAX_SIDE = 1600;

const DAY = 86_400_000;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const centsOf = (v: string | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v) * 100));

// ---------------------------------------------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------------------------------------------

export type SaleLinkInput = { saleId?: number | null; captureId?: string | null; paypalEmail?: string | null };

export type SubmitInput = {
  recallNumber: string;
  photo: Buffer;
  mime: string | null;
  /** web: the claim page; try: the Try page's "Your photo"; api: a call with a key; link: a personal claim link. */
  source: "web" | "try" | "api" | "link";
  link?: SaleLinkInput | null;
  /** End-to-end tests only (guarded by CHECKS_SECRET in the route). */
  test?: { noAi?: boolean; amountCents?: number } | null;
  /** The token from a firm's personal claim link (`?n=`), so the firm can see which notice led to this claim. */
  noticeToken?: string | null;
};

type SaleRow = typeof schema.sales.$inferSelect;
type Linked = { sale: SaleRow; view: LinkView };

/** Link the owner's PayPal purchase from the sample shop, so the refund can go back to it inside 180 days. */
async function linkSale(recallNumber: string, link: SaleLinkInput | null | undefined, now: Date): Promise<Linked | { view: LinkView } | null> {
  if (!link || (!link.saleId && !link.paypalEmail)) return null;
  if (recallNumber !== SHOP_RECALL) return { view: { status: "not_this_recall", message: "Purchases from the Brightline sample shop link only to the sample charger recall, BH-2026-01." } };
  let sale: SaleRow | undefined;
  if (link.saleId && link.captureId) {
    [sale] = await db()
      .select()
      .from(schema.sales)
      .where(and(eq(schema.sales.id, link.saleId), eq(schema.sales.paypalCaptureId, link.captureId)))
      .limit(1);
  } else if (link.paypalEmail) {
    const found = await salesForBuyer(link.paypalEmail);
    const ids = found.map((s) => Number(s.id)).filter(Number.isInteger);
    if (ids.length) {
      const rows = await db().select().from(schema.sales).where(inArray(schema.sales.id, ids)).orderBy(desc(schema.sales.paidAt));
      sale = rows.find((r) => r.paypalCaptureId);
    }
  }
  if (!sale?.paypalCaptureId) return { view: { status: "not_found", message: "We could not find a Brightline purchase for that. Your refund can still be sent to your PayPal account." } };
  const paidAt = sale.paidAt ?? sale.createdAt;
  const w = refundWindow(paidAt, now);
  if (!w.within) return { view: { status: "too_old", message: "That purchase was more than 180 days ago, past PayPal's refund window. Your refund can be sent to your PayPal account instead." } };
  const [used] = await db()
    .select({ n: count() })
    .from(schema.claims)
    .where(and(eq(schema.claims.linkedSaleId, sale.id), inArray(schema.claims.decision, ["verified", "firm_review"])));
  if ((used?.n ?? 0) > 0) return { view: { status: "already_claimed", message: "That purchase already has a claim, so this one is checked on its own." } };
  return {
    sale,
    view: { status: "linked", paid_at: paidAt.toISOString(), amount: Number(sale.amount).toFixed(2), item: sale.itemName, refundable_until: w.deadline, days_left: w.daysLeft },
  };
}

/**
 * Store the photo: the resized JPEG for the receipt and the firm's queue in `bytes`, and the owner's original in
 * `original` until the checks have run on it (the checks need the untouched bytes: the EXIF flag, the hash, and the
 * verification cache key). checkClaim clears `original` when it is done.
 */
async function storePhoto(bytes: Buffer, mime: string | null, source: "upload" | "preset") {
  let stored: Buffer = bytes;
  let storedMime = mime ?? "application/octet-stream";
  let width: number | null = null;
  let height: number | null = null;
  try {
    const out = await sharp(bytes, { failOn: "error", limitInputPixels: 60_000_000 })
      .rotate()
      .resize(STORED_MAX_SIDE, STORED_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    stored = out.data;
    storedMime = "image/jpeg";
    width = out.info.width;
    height = out.info.height;
  } catch {
    /* a format sharp cannot read (HEIC): keep the original bytes; the checks will ask for a JPEG */
  }
  const [row] = await db()
    .insert(schema.photos)
    .values({ sha256: sha256(bytes), mime: storedMime, size: bytes.byteLength, width, height, bytes: stored, original: bytes, source })
    .returning({ id: schema.photos.id });
  return row.id;
}

/**
 * Live vision, unless there is no key, the AI is paused or a test asks for none. The wrappers only report progress:
 * the verification cache and the daily budget are passed in explicitly, so verifyPhoto still answers repeats from
 * the cache and hands over to a person ("resting for today") past the budget.
 */
function verifyDeps(test: SubmitInput["test"], emit: (e: ClaimEvent) => void): VerifyDeps {
  if (test?.noAi) return { aiAvailable: () => false, cache: null };
  if (!aiAvailable()) return {};
  return {
    cache: defaultVerifyCache(),
    overBudget,
      vision: async (a) => {
        const t = performance.now();
        emit({ type: "stage", stage: "vision", state: "start" });
        try {
          return await runVision(a);
        } finally {
          emit({ type: "stage", stage: "vision", state: "done", ms: Math.round(performance.now() - t) });
        }
      },
      reviewers: async (a) => {
        const t = performance.now();
        emit({ type: "stage", stage: "reviewers", state: "start" });
        try {
          return await runReviewers(a);
        } finally {
          emit({ type: "stage", stage: "reviewers", state: "done", ms: Math.round(performance.now() - t) });
        }
      },
  };
}

/** What the claim row keeps beside the six checks: the rest of the verifier's answer, for the owner's and firm's views. */
export type StoredResult = {
  decided_by: string;
  guidance: VerifyResult["guidance"] | null;
  summary: VerifyResult["summary"];
  quality: { ok: boolean; issues: string[] };
  blockers: VerifyResult["blockers"];
  timings: VerifyResult["timings"];
  model: string | null;
  usage: VerifyResult["usage"];
  official: VerifyResult["official"];
  photo: { width: number; height: number; exif: boolean; mime: string | null; dhash: string | null };
  amount_source: "firm" | "capture" | "demo" | null;
  /** firm: written by hand by the (sample) firm, no model. */
  rule_source: "ai" | "quick_read" | "firm";
  source: SubmitInput["source"];
  link: LinkView | null;
  resting: boolean;
};

/** What the verify_claim job needs beside the claim row: the request's own facts, none of them personal. */
export type CheckOptions = { test: SubmitInput["test"]; source: SubmitInput["source"]; mime: string | null; link: LinkView | null };

/**
 * Open the claim: store the photo, insert the claim row, mark a personal claim link answered, and write the first
 * ledger entry. Fast, no model call. The checks run next in checkClaim, as a verify_claim job (src/lib/jobs).
 */
export async function openClaim(input: SubmitInput, emit: (e: ClaimEvent) => void = () => {}): Promise<{ claimId: string; options: CheckOptions }> {
  if (!dbConfigured()) throw new ClaimError("upstream_unavailable", "Claims need the database, which is not set up on this server.", 503);
  const recall = getRecall(input.recallNumber);
  if (!recall) throw new ClaimError("not_found", "There is no recall with that number in Remedy's list. Search for it on the Recalls page.", 404);
  if (!input.photo.byteLength) throw new ClaimError("invalid_request", "Please add a photo.", 400);
  if (input.photo.byteLength > MAX_PHOTO_BYTES) throw new ClaimError("invalid_request", "That photo is over 15 MB. Please send a smaller one.", 413);

  const now = new Date();
  const terms = await firmTerms(recall.number);
  const linked = await linkSale(recall.number, input.link, now);
  const sale = linked && "sale" in linked ? linked.sale : null;

  const photoId = await storePhoto(input.photo, input.mime, "upload");
  const isTest = Boolean(input.test);
  const [claim] = await db()
    .insert(schema.claims)
    .values({
      recallNumber: recall.number,
      firmId: terms.firmId,
      photoId,
      linkedSaleId: sale?.id ?? null,
      channel: input.source === "api" ? "api" : input.source === "link" ? "link" : "web",
      status: "checking",
      decision: "pending",
      isSample: isTest,
    })
    .returning({ id: schema.claims.id });
  emit({ type: "claim", id: claim.id, recall: recall.number });
  emit({ type: "stage", stage: "stored", state: "done" });
  // A personal claim link: mark its notice claimed, for this recall only. Only the token's hash is stored.
  if (input.noticeToken && /^[A-Za-z0-9_-]{16,128}$/.test(input.noticeToken)) {
    const hash = createHash("sha256").update(input.noticeToken).digest("hex");
    await db()
      .update(schema.notices)
      .set({ status: "claimed", claimId: claim.id })
      .where(and(eq(schema.notices.claimLinkTokenHash, hash), eq(schema.notices.recallNumber, recall.number)));
  }
  await audit("person", "claim.submitted", `claim:${claim.id}`, { recall: recall.number, source: input.source, photo: photoId, linked_sale: sale?.id ?? null, test: isTest });
  log.info("claim opened", { claim_id: claim.id, recall: recall.number, source: input.source, linked_sale: sale?.id ?? null, test: isTest });
  return { claimId: claim.id, options: { test: input.test ?? null, source: input.source, mime: input.mime, link: linked?.view ?? null } };
}

/** The claim's original photo bytes, kept until the checks ran. */
async function originalPhoto(photoId: string): Promise<Buffer | null> {
  const [p] = await db().select({ original: schema.photos.original, bytes: schema.photos.bytes }).from(schema.photos).where(eq(schema.photos.id, photoId)).limit(1);
  return p?.original ?? p?.bytes ?? null;
}

/**
 * Run the six checks on an open claim and record the decision: the verify_claim job's work. `final` says this is
 * the job's last try, so a check that still fails hands the claim to a person at the firm instead of leaving it
 * "checking". Safe to run again: a claim already decided is returned as it is.
 */
export async function checkClaim(claimId: string, options: CheckOptions, emit: (e: ClaimEvent) => void = () => {}, o: { final?: boolean } = {}): Promise<ClaimView> {
  const row = await loadClaim(claimId);
  if (!row) throw new ClaimError("not_found", "There is no claim with that id.", 404);
  if (row.decision !== "pending") {
    const done = (await getClaimView(claimId))!;
    emit({ type: "result", claim: done });
    return done;
  }
  const recall = getRecall(row.recallNumber);
  if (!recall) throw new ClaimError("not_found", "The recall for this claim is no longer in Remedy's list.", 404);
  const photoId = row.photoId;
  const photo = photoId ? await originalPhoto(photoId) : null;
  if (!photoId || !photo) throw new ClaimError("internal", "The photo for this claim is missing.", 500);
  const { rule, source: ruleSource } = ruleFor(recall);
  const terms = await firmTerms(recall.number);
  const sale = row.linkedSaleId ? (await db().select().from(schema.sales).where(eq(schema.sales.id, row.linkedSaleId)).limit(1))[0] : undefined;
  const input: SubmitInput = { recallNumber: recall.number, photo, mime: options.mime, source: options.source, test: options.test };
  const claim = { id: claimId };
  const linked = options.link ? { view: options.link } : null;

  const [priorRows, [recallCount]] = await Promise.all([
    db()
      .select({ ref: schema.imageHashes.ref, dhash: schema.imageHashes.dhash })
      .from(schema.imageHashes)
      .where(and(eq(schema.imageHashes.source, "claim"), eq(schema.imageHashes.recallNumber, recall.number)))
      .orderBy(desc(schema.imageHashes.id))
      .limit(5000),
    db()
      .select({ n: count() })
      .from(schema.claims)
      .where(and(eq(schema.claims.recallNumber, recall.number), inArray(schema.claims.decision, ["verified", "firm_review"]))),
  ]);

  const testAmount = input.test?.amountCents;
  const firmCents = testAmount ?? (sale ? centsOf(sale.amount)! : terms.refundCents);
  const amountSource: StoredResult["amount_source"] = sale ? "capture" : testAmount ? "firm" : terms.refundSource;
  const ctx: ClaimContext = {
    payeeClaimCount: 0,
    unitsPurchased: 1,
    recallClaimCount: recallCount?.n ?? 0,
    firmAmount: { value: toValue(firmCents), currency: "USD" },
    autoCap: { value: toValue(terms.autoCapCents), currency: "USD" },
    linkedCapture: sale?.paypalCaptureId ? { id: sale.paypalCaptureId, amount: { value: Number(sale.amount).toFixed(2), currency: "USD" }, capturedAt: (sale.paidAt ?? sale.createdAt).toISOString() } : null,
    hasPriorRefund: (id) => priorRefundCheck(id),
    firmName: terms.firmName,
  };

  const deps = verifyDeps(input.test, emit);
  let result: VerifyResult;
  try {
    result = await verifyPhoto(
      { photo: input.photo, mime: input.mime ?? undefined, recall: verifyRecallFor(recall), proofRule: rule, priorHashes: priorRows.map((r) => ({ ref: r.ref, dhash: r.dhash })), claimContext: ctx },
      deps,
    );
  } catch (e) {
    log.error("claim check failed", { claim_id: claim.id, final: Boolean(o.final), error: e });
    if (!o.final) throw e; // the job tries again with backoff
    await db().update(schema.claims).set({ status: "firm_review", decision: "firm_review", decidedAt: new Date(), updatedAt: new Date() }).where(eq(schema.claims.id, claim.id));
    await audit("system", "claim.check_failed", `claim:${claim.id}`, { error: (e as Error).message.slice(0, 300) });
    throw new ClaimError("internal", "Something went wrong while checking the photo. A person at the firm will look at it.", 500);
  }
  const resting = result.summary.plain === RESTING_PLAIN || Object.values(result.checks).some((c) => c.reason_plain === RESTING_PLAIN);

  const stored: StoredResult = {
    decided_by: result.decided_by,
    guidance: result.guidance ?? null,
    summary: result.summary,
    quality: { ok: result.quality.ok, issues: result.quality.issues },
    blockers: result.blockers,
    timings: result.timings,
    model: result.model,
    usage: result.usage,
    official: result.official,
    photo: { width: result.photo.width, height: result.photo.height, exif: result.photo.exif, mime: result.photo.mime, dhash: result.photo.dhash },
    amount_source: result.amount ? amountSource : null,
    rule_source: ruleSource,
    source: input.source,
    link: linked?.view ?? null,
    resting,
  };
  if (!photoId) throw new ClaimError("internal", "The photo for this claim is missing.", 500);
  await db()
    .update(schema.claims)
    .set({
      checks: result.checks,
      result: stored,
      decision: result.decision,
      status: result.decision,
      debate: result.review,
      amount: result.amount ? result.amount.value : null,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.claims.id, claim.id));
  if (result.photo.dhash) {
    await db().update(schema.photos).set({ dhash: result.photo.dhash }).where(eq(schema.photos.id, photoId));
    // Only photos that could be paid are kept for the earlier-claim check, so an owner's own retake never trips it.
    if (result.decision !== "retake") {
      await db().insert(schema.imageHashes).values({ source: "claim", ref: photoId, recallNumber: recall.number, dhash: result.photo.dhash }).onConflictDoNothing();
    }
  }
  await audit("system", "claim.decided", `claim:${claim.id}`, {
    decision: result.decision,
    decided_by: result.decided_by,
    checks: Object.fromEntries(CHECK_IDS.map((id) => [id, result.checks[id].status])),
    amount: result.amount?.value ?? null,
    model: result.model,
    ms: result.timings.total_ms,
  });
  // The checks ran: the owner's original bytes are no longer needed; the resized copy stays for the receipt.
  await db().update(schema.photos).set({ original: null }).where(eq(schema.photos.id, photoId));
  log.info("claim decided", { claim_id: claim.id, recall: recall.number, decision: result.decision, decided_by: result.decided_by, model: result.model, ms: result.timings.total_ms });
  const view = await getClaimView(claim.id);
  emit({ type: "result", claim: view! });
  return view!;
}

/** Open the claim and run its checks in this process (tests and the inline path). The route uses the job queue. */
export async function submitClaim(input: SubmitInput, emit: (e: ClaimEvent) => void = () => {}): Promise<ClaimView> {
  const { claimId, options } = await openClaim(input, emit);
  return checkClaim(claimId, options, emit, { final: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------------------------

type ClaimRow = typeof schema.claims.$inferSelect;

export const isClaimId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

async function loadClaim(id: string): Promise<ClaimRow | null> {
  if (!isClaimId(id) || !dbConfigured()) return null;
  const [row] = await db().select().from(schema.claims).where(eq(schema.claims.id, id)).limit(1);
  return row ?? null;
}

function paymentView(s: Awaited<ReturnType<typeof paymentSummary>>): PaymentView | null {
  const { plan, payment, status } = s;
  if (!plan) return null;
  return {
    route: plan.route,
    plan_status: plan.status,
    amount: toValue(payment?.amountCents ?? plan.amountCents),
    currency: "USD",
    reasons: plan.reasons,
    approval: plan.approval ? { by: plan.approval.by, who: plan.approval.who, rule: plan.approval.rule ?? null, at: plan.approval.at } : null,
    status: payment?.status ?? null,
    status_label: status?.label ?? null,
    status_plain: status?.plain ?? null,
    final: status?.final ?? false,
    paypal_status: payment?.paypalStatus ?? null,
    payee: s.payee ? { type: s.payee.type, masked: s.payee.masked } : null,
    ids: {
      payout_batch_id: payment?.payoutBatchId ?? null,
      payout_item_id: payment?.payoutItemId ?? null,
      transaction_id: payment?.transactionId ?? null,
      refund_id: payment?.refundId ?? null,
      order_id: payment?.orderId ?? null,
      capture_id: payment?.captureId ?? plan.captureId ?? null,
      debug_id: payment?.debugId ?? null,
    },
    issue: payment?.issue ?? null,
    replacement: plan.replacement ? { title: plan.replacement.title, retailer: plan.replacement.retailer, url: plan.replacement.url ?? null } : null,
    updated_at: payment?.updatedAt ?? plan.updatedAt ?? null,
  };
}

/** Where a claim stands once its payment moves: paid, waiting to be accepted, or still on its way. */
function statusFromPayment(row: ClaimRow, p: PaymentView | null): ClaimStatus {
  if (!p) return row.status as ClaimStatus;
  if (p.status === "paid") return "paid";
  if (p.status === "unclaimed") return "unclaimed";
  if (p.plan_status === "approved" || p.plan_status === "executing" || p.plan_status === "submitted" || p.plan_status === "paid") return "approved";
  return row.status as ClaimStatus;
}

export async function getClaimView(id: string, opts: { refresh?: boolean } = {}): Promise<ClaimView | null> {
  const row = await loadClaim(id);
  if (!row) return null;
  if (opts.refresh) await refreshPayment(id).catch(() => null);
  const summary = await paymentSummary(id).catch(() => ({ plan: null, payment: null, status: null, payee: null }));
  const payment = paymentView(summary);
  const status = statusFromPayment(row, payment);
  if (status !== row.status) {
    await db().update(schema.claims).set({ status, updatedAt: new Date() }).where(eq(schema.claims.id, id));
    if (status === "paid") await audit("system", "claim.paid", `claim:${id}`, { route: payment?.route, amount: payment?.amount });
  }
  return toView({ ...row, status }, payment);
}

export async function toView(row: ClaimRow, payment: PaymentView | null): Promise<ClaimView> {
  const recall = getRecall(row.recallNumber);
  const terms = await firmTerms(row.recallNumber);
  const r = (row.result ?? null) as StoredResult | null;
  const checks = (row.checks ?? {}) as Record<string, { id: CheckView["id"]; name: string; status: CheckView["status"]; pass: boolean; score?: number; reason_plain: string; reason_technical: string }>;
  return {
    id: row.id,
    recall: { number: row.recallNumber, title: recall?.title ?? `Recall ${row.recallNumber}`, product: recall ? productName(recall) : `Recall ${row.recallNumber}` },
    status: row.status as ClaimStatus,
    decision: row.decision as ClaimView["decision"],
    decided_by: r?.decided_by ?? null,
    channel: row.channel,
    created_at: row.createdAt.toISOString(),
    decided_at: row.decidedAt?.toISOString() ?? null,
    checks: CHECK_IDS.filter((id) => checks[id]).map((id) => ({
      id,
      name: checks[id].name,
      status: checks[id].status,
      pass: checks[id].pass,
      score: typeof checks[id].score === "number" ? checks[id].score! : null,
      reason_plain: checks[id].reason_plain,
      reason_technical: checks[id].reason_technical,
    })),
    guidance: r?.guidance ?? null,
    summary: r?.summary ?? null,
    amount: row.amount ? { value: Number(row.amount).toFixed(2), currency: "USD", source: r?.amount_source ?? "firm" } : null,
    quality: r?.quality ?? null,
    timings: r?.timings ?? null,
    model: r?.model ?? null,
    review: (row.debate as ClaimView["review"]) ?? null,
    link: r?.link ?? null,
    payment,
    firm: { name: terms.firmName, sample: true, review_hours: terms.reviewHours, refund_source: terms.refundSource },
    photo_url: row.photoId ? `/api/claims/${row.id}/photo` : null,
    receipt_url: `/r/${row.id}`,
    sandbox_label: SANDBOX_LABEL,
  };
}

/** The stored photo for a claim (the resized JPEG), for the receipt. */
export async function claimPhoto(id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = await loadClaim(id);
  if (!row?.photoId) return null;
  const [p] = await db().select({ bytes: schema.photos.bytes, mime: schema.photos.mime }).from(schema.photos).where(eq(schema.photos.id, row.photoId)).limit(1);
  return p?.bytes ? { bytes: p.bytes, mime: p.mime } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Pay
// ---------------------------------------------------------------------------------------------------------------

export type PayInput = {
  choice: "money" | "replacement";
  payee_type?: "email" | "phone" | "venmo" | null;
  payee?: string | null;
  replacement_id?: string | null;
};

/**
 * Claims on this recall by the same payee that can be paid (C5 at payment time: one refund per unit bought). The
 * firm console's seeded sample history and test claims (is_sample) are not anyone's real claim, so they do not count.
 */
async function payeeClaims(recallNumber: string, payeeHash: string, except: string) {
  const [r] = await db()
    .select({ n: count() })
    .from(schema.claims)
    .where(
      and(
        eq(schema.claims.recallNumber, recallNumber),
        eq(schema.claims.payeeHash, payeeHash),
        ne(schema.claims.id, except),
        eq(schema.claims.isSample, false),
        inArray(schema.claims.status, ["approved", "paid", "unclaimed", "verified", "firm_review"]),
      ),
    );
  return r?.n ?? 0;
}

/**
 * Whether a product matches an active recall in Remedy's list: keyword match over the nearest recalls. Words every
 * product of a kind shares ("power bank", "portable") are not enough on their own; a strong keyword match, or the
 * product's brand named in a nearby recall, is.
 */
export async function recallCheckFor(title: string, brand?: string | null): Promise<ReplacementOption["recall_check"]> {
  try {
    const res = await searchRecalls(title, { k: 8 });
    const cands = res.hits.map(candidateFromHit);
    const m = heuristicMatch(title, cands);
    const b = (brand ?? "").trim().toLowerCase();
    const brandHit = b.length >= 3 ? res.hits.find((h) => `${h.title} ${h.productNames.join(" ")}`.toLowerCase().includes(b)) : undefined;
    const clear = m.decision !== "MATCH" && !brandHit;
    return {
      clear,
      plain: clear ? "No active recall" : "May match a recall",
      technical: `Checked against ${res.hits.length} nearest recalls (${res.mode === "elastic" ? "Elastic hybrid search" : "in-app BM25"}): keyword match ${m.confidence} (a match from 0.75)${m.recallNumber ? `, nearest recall ${m.recallNumber}` : ""}; brand ${b ? (brandHit ? `"${brand}" named in recall ${brandHit.number}` : `"${brand}" in none`) : "not given"}.`,
    };
  } catch (e) {
    return { clear: false, plain: "Could not check recalls", technical: `Recall search failed: ${(e as Error).message}` };
  }
}

async function replacementFor(id: string, claimId: string): Promise<Replacement> {
  const p = await getProduct(id, claimId).catch(() => null);
  if (!p) throw new ClaimError("invalid_request", "That replacement is no longer available. Please pick another one, or choose a refund.", 400);
  const priceCents = Math.round(p.price * 100);
  if (priceCents > PAY_LIMITS.perPaymentCents) throw new ClaimError("invalid_request", `Sandbox demo replacements are limited to $${toValue(PAY_LIMITS.perPaymentCents)}.`, 400);
  const check = await recallCheckFor(`${p.brand ?? ""} ${p.title}`.trim(), p.brand);
  return { productId: p.id, title: p.title, priceCents, retailer: p.domain ?? p.brand ?? "Retailer", url: p.url, noActiveRecall: check.clear };
}

/**
 * Pay an approved plan through a pay_claim job (src/lib/jobs): the worker sends it, retrying on a PayPal hiccup with
 * backoff, and this call waits for the answer. With no worker running, the job runs inline after 2 s. The job's
 * handler updates the claim's status; a job that reached its dead letter reads as "retry_later".
 */
async function payViaJob(id: string): Promise<{ kind: string; plain: string }> {
  const job = await runJob("pay_claim", { claimId: id }, { timeoutMs: 120_000 });
  if (job?.status === "done" && job.result && typeof job.result === "object") return job.result as { kind: string; plain: string };
  log.warn("pay_claim job did not finish in time", { claim_id: id, job_id: job?.id ?? null, status: job?.status ?? null });
  return { kind: "retry_later", plain: "The payment could not be sent just now. A person at the firm can try again." };
}

export async function payForClaim(id: string, input: PayInput): Promise<PayView> {
  const row = await loadClaim(id);
  if (!row) throw new ClaimError("not_found", "There is no claim with that id.", 404);
  if (row.decision === "pending") throw new ClaimError("invalid_request", "This claim is still being checked. Please wait a moment.", 409);
  if (row.decision === "retake") throw new ClaimError("invalid_request", "This claim needs a new photo before it can be paid.", 409);
  const recall = getRecall(row.recallNumber);
  if (!recall) throw new ClaimError("not_found", "The recall for this claim is no longer in Remedy's list.", 404);
  const terms: FirmTerms = await firmTerms(row.recallNumber);

  const existing = await paymentSummary(id);
  if (existing.plan && existing.plan.status !== "canceled") {
    // Paying twice never pays twice: an existing plan is reported, and paid once if it is approved and not yet sent.
    const r = existing.plan.status === "approved" ? await payViaJob(id) : null;
    const view = (await getClaimView(id))!;
    return { kind: r?.kind ?? "already", plain: r?.plain ?? view.payment?.status_plain ?? "This claim already has a payment plan.", claim: view };
  }

  let payee: Payee | null = null;
  if (input.payee_type && input.payee?.trim()) {
    payee = { type: input.payee_type, value: input.payee.trim() };
    const rcpt = recipientFor(payee);
    if ("error" in rcpt) throw new ClaimError("invalid_request", rcpt.error, 400);
    payee = { type: input.payee_type, value: rcpt.receiver };
  }
  const sale = row.linkedSaleId ? (await db().select().from(schema.sales).where(eq(schema.sales.id, row.linkedSaleId)).limit(1))[0] : undefined;
  if (input.choice === "money" && !payee && !sale?.paypalCaptureId) throw new ClaimError("invalid_request", "Add the email or phone number of your PayPal account, so we know where to send the refund.", 400);
  const replacement = input.choice === "replacement" ? (input.replacement_id ? await replacementFor(input.replacement_id, id) : null) : null;
  if (input.choice === "replacement" && !replacement) throw new ClaimError("invalid_request", "Please pick a replacement, or choose a refund.", 400);

  // C5 at payment time: one refund per payee per recall unless a person at the firm approves more.
  const payeeHash = payee ? hashContact(payee.value) : null;
  const overLimit = payeeHash ? (await payeeClaims(row.recallNumber, payeeHash, id)) >= 1 : false;
  const amountCents = centsOf(row.amount) ?? DEMO_REFUND_CENTS;

  const planned = await planPayment(
    {
      claimId: id,
      recallNumber: row.recallNumber,
      recallTitle: productName(recall),
      firmId: terms.firmId !== null ? String(terms.firmId) : null,
      decision: overLimit ? "firm_review" : (row.decision as "verified" | "firm_review"),
      amountCents,
      payee,
      choice: input.choice,
      linkedCaptureId: sale?.paypalCaptureId ?? null,
      replacement,
    },
    { autoCapCents: terms.autoCapCents },
  );
  if (!planned.ok) throw new ClaimError("invalid_request", planned.plain, planned.code === "over_limit" ? 400 : 400);

  await db()
    .update(schema.claims)
    .set({
      payeeType: payee?.type ?? null,
      payeeValueEnc: payee ? encrypt(payee.value) : null,
      payeeHash,
      payeeMasked: payee ? maskContact(payee.value) : null,
      status: planned.plan.status === "approved" ? "approved" : row.status === "verified" && overLimit ? "firm_review" : (row.status as ClaimStatus),
      updatedAt: new Date(),
    })
    .where(eq(schema.claims.id, id));
  if (overLimit) await audit("system", "claim.limit_review", `claim:${id}`, { reason: "payee already has a claim on this recall", masked: payee ? maskPayee(payee) : null });

  let kind: string = "needs_approval";
  let plain = `A person at ${terms.firmName} will approve this payment.`;
  log.info("payment planned", { claim_id: id, route: planned.plan.route, plan_status: planned.plan.status, choice: input.choice, over_limit: overLimit });
  if (planned.plan.status === "approved") {
    const r = await payViaJob(id);
    kind = r.kind;
    plain = r.plain;
  } else if (overLimit) {
    plain = `This email or phone already has a refund for this recall, so a person at ${terms.firmName} will check this one.`;
  }
  return { kind, plain, claim: (await getClaimView(id))! };
}

// ---------------------------------------------------------------------------------------------------------------
// Safe replacement options (Channel3, each checked against the recall list)
// ---------------------------------------------------------------------------------------------------------------

export async function replacementOptions(id: string): Promise<{ mode: "live" | "not_connected"; query: string; max_price: string; options: ReplacementOption[]; excluded: number; note: string | null }> {
  const row = await loadClaim(id);
  if (!row) throw new ClaimError("not_found", "There is no claim with that id.", 404);
  const recall = getRecall(row.recallNumber);
  if (!recall) throw new ClaimError("not_found", "The recall for this claim is no longer in Remedy's list.", 404);
  const cap = Math.min(centsOf(row.amount) ?? DEMO_REFUND_CENTS, PAY_LIMITS.perPaymentCents);
  const query = replacementQuery(recall);
  let found;
  try {
    found = await findProducts(query, { maxPrice: cap / 100, user: id, limit: 8 });
  } catch (e) {
    return { mode: "live", query, max_price: toValue(cap), options: [], excluded: 0, note: `Replacement search did not answer just now (${(e as Error).message}). A refund still works.` };
  }
  const priced = found.products.filter((p) => p.currency === "USD" && Math.round(p.price * 100) <= cap && p.price > 0);
  const checked = await Promise.all(priced.slice(0, 6).map(async (p) => ({ p, check: await recallCheckFor(`${p.brand ?? ""} ${p.title}`.trim(), p.brand) })));
  const options = checked
    .filter((c) => c.check.clear)
    .map(({ p, check }) => ({ id: p.id, title: p.title, brand: p.brand, image: p.image, image_alt: p.imageAlt, price: p.price.toFixed(2), retailer: p.domain, url: p.url, recall_check: check }));
  return { mode: found.mode, query, max_price: toValue(cap), options, excluded: checked.length - options.length, note: found.note ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// Firm approval for end-to-end tests (the route checks CHECKS_SECRET)
// ---------------------------------------------------------------------------------------------------------------

export async function approveAndPayForTest(id: string) {
  const row = await loadClaim(id);
  if (!row) throw new ClaimError("not_found", "There is no claim with that id.", 404);
  const s = await paymentSummary(id);
  if (!s.plan) throw new ClaimError("invalid_request", "This claim has no payment plan yet. Choose where the refund goes first.", 409);
  const approved = s.plan.status === "awaiting_approval" ? await approvePlan(s.plan.id, "e2e reviewer") : { ok: true as const, plan: s.plan };
  await db().update(schema.claims).set({ reviewOutcome: "approved", reviewedBy: "e2e reviewer", reviewedAt: new Date(), updatedAt: new Date() }).where(eq(schema.claims.id, id));
  const r = await payViaJob(id);
  return { approved: approved.ok, kind: r.kind, plain: r.plain, claim: (await getClaimView(id))! };
}

// ---------------------------------------------------------------------------------------------------------------
// Limits on live checks (per client and per day), on top of the API's per-minute limit
// ---------------------------------------------------------------------------------------------------------------

/** Claims a day across the whole demo site, on top of each visitor's upload limit and the daily AI budget. */
export const LIVE_LIMITS = { perDay: 300 } as const;

/**
 * Upload limits for a photo claim: the verifier's per-visitor limit (6 per 10 minutes, 30 a day per hashed IP) and a
 * site-wide daily count. Keyed API calls have their own limits in the API guard; end-to-end tests are exempt.
 */
export async function liveLimit(o: { ip: string; keyed: boolean; test: boolean }): Promise<{ ok: true } | { ok: false; message: string; retryAfter: number }> {
  if (o.test) return { ok: true };
  if (!o.keyed) {
    const v = await allowUpload(o.ip);
    if (!v.ok) return { ok: false, message: v.plain, retryAfter: v.retryAfterSec };
  }
  if (!dbConfigured()) return { ok: true };
  const [today] = await db()
    .select({ n: count() })
    .from(schema.claims)
    .where(gte(schema.claims.createdAt, new Date(Date.now() - DAY)));
  if ((today?.n ?? 0) >= LIVE_LIMITS.perDay) return { ok: false, message: "Remedy has checked a lot of photos today. Please try again tomorrow, or open one of the ready-made examples.", retryAfter: 3600 };
  return { ok: true };
}
