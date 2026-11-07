import { recallLabel } from "@/lib/recall/label";
import { LIMITS, resolveDeps, usd, type PaymentsDeps } from "./deps";
import { recordStatus } from "./events";
import { createPayoutBatch, normalizeEmail, normalizeUsPhone, recipientFor, senderBatchIdFor, senderItemIdFor, type PayoutLine } from "./payouts";
import { hasPriorRefund, refundCapture, refundWindow } from "./refunds";
import { payReplacement } from "./replacement";
import { describeStatus } from "./status";
import { paymentIdFor } from "./store";
import type { Approval, Payee, PaymentPlan, PaymentRecord, PaymentRoute, PaymentStatus, Replacement } from "./types";

/**
 * The payment router (plan 7.3). Deterministic code, never the model:
 *   linked PayPal capture, 180 days old or less, not refunded or disputed  -> refund to that capture
 *   else the owner chose a replacement with no active recall              -> Orders v2 to the retailer stand-in
 *   else                                                                   -> Payouts item (email, phone or Venmo)
 * Every route goes through a PaymentPlan, approved by the firm's auto rule or a reviewer, and every step is written
 * to the ledger. Paying is idempotent per claim: one current plan per claim, a compare-and-set before any money
 * moves, and PayPal idempotency keys derived from the claim and attempt, so a second "pay" never pays twice.
 */

export type ClaimForPayment = {
  claimId: string;
  recallNumber: string;
  recallTitle: string;
  firmId?: string | null;
  /** The verification decision (plan 7.2). A retake is never paid. */
  decision: "verified" | "retake" | "firm_review";
  /** The refund amount from verification: the firm's amount for the model or the linked capture, whichever is lower. */
  amountCents: number;
  payee: Payee | null;
  choice: "money" | "replacement";
  linkedCaptureId?: string | null;
  replacement?: Replacement | null;
};

export type CaptureFacts = { id: string; found: boolean; capturedAt: string | null; remainingCents: number; refunded: boolean; disputed: boolean };
export type RouteFacts = { choice: "money" | "replacement"; capture: CaptureFacts | null; replacement: Replacement | null; payee: Payee | null; now: Date };
export type RouteChoice = { route: PaymentRoute | null; plain: string; technical: string };

const payeeWords = (p: Payee) => (p.type === "email" ? "your PayPal account by email" : p.type === "phone" ? "your PayPal account by phone number" : "your Venmo account");

/** Pick the route from the facts. Pure: the same facts always give the same route. */
export function chooseRoute(f: RouteFacts): RouteChoice {
  const notes: string[] = [];
  const c = f.capture;
  if (c) {
    const w = c.capturedAt ? refundWindow(c.capturedAt, f.now) : null;
    if (c.found && w?.within && !c.refunded && !c.disputed && c.remainingCents > 0) {
      return {
        route: "refund",
        plain: `You paid with PayPal ${w.ageDays === 0 ? "today" : `${w.ageDays} ${w.ageDays === 1 ? "day" : "days"} ago`}, so the refund goes back to that same payment.`,
        technical: `Linked capture ${c.id}, age ${w.ageDays} d (limit 180 d), no prior refund or dispute: POST /v2/payments/captures/${c.id}/refund.`,
      };
    }
    if (!c.found) notes.push("The linked PayPal purchase was not found.");
    else if (w && !w.within) notes.push("Your PayPal purchase was more than 180 days ago, past PayPal's refund window.");
    else if (c.refunded) notes.push("Your PayPal purchase already has a refund.");
    else if (c.disputed) notes.push("Your PayPal purchase has a dispute.");
  }
  const why = notes.length ? `${notes.join(" ")} ` : "";
  if (f.choice === "replacement") {
    if (f.replacement?.noActiveRecall) {
      return {
        route: "replacement",
        plain: `${why}You chose a safe replacement. The firm pays the retailer, and the retailer ships it to you.`,
        technical: `${c ? `Capture ${c.id} not refundable. ` : ""}Owner chose replacement ${f.replacement.productId}; no active recall matched: Orders v2 to the retailer stand-in.`,
      };
    }
    notes.push(f.replacement ? "That replacement could not be confirmed as free of recalls." : "No replacement was chosen.");
  }
  if (f.payee) {
    return {
      route: "payout",
      plain: `${notes.length ? `${notes.join(" ")} ` : ""}We send the refund to ${payeeWords(f.payee)}.`,
      technical: `${c ? `Capture ${c.id} not refundable. ` : ""}Payouts item, recipient_type ${f.payee.type === "email" ? "EMAIL" : "PHONE"}${f.payee.type === "venmo" ? ", recipient_wallet VENMO" : ""}.`,
    };
  }
  return { route: null, plain: `${notes.length ? `${notes.join(" ")} ` : ""}Add an email or phone number so we can send the refund.`, technical: "No refundable capture, no replacement and no payee." };
}

export type PlanResult = { ok: true; plan: PaymentPlan; created: boolean } | { ok: false; code: "not_payable" | "invalid_payee" | "no_route" | "over_limit"; plain: string };

/** Build, store and (when the firm's auto rule allows) approve the payment plan for a verified or reviewed claim. */
export async function planPayment(claim: ClaimForPayment, opts: { autoCapCents?: number } = {}, partial?: Partial<PaymentsDeps>): Promise<PlanResult> {
  const deps = await resolveDeps(partial);
  const existing = await deps.store.getPlanByClaim(claim.claimId);
  if (existing && existing.status !== "canceled") return { ok: true, plan: existing, created: false };

  if (claim.decision === "retake") return { ok: false, code: "not_payable", plain: "This claim needs a new photo before it can be paid." };
  if (!Number.isInteger(claim.amountCents) || claim.amountCents <= 0) return { ok: false, code: "not_payable", plain: "This claim has no refund amount yet." };
  if (claim.amountCents > LIMITS.perPaymentCents) return { ok: false, code: "over_limit", plain: `Sandbox demo payments are limited to ${usd(LIMITS.perPaymentCents)} each.` };
  if (claim.payee) {
    const r = recipientFor(claim.payee);
    if ("error" in r) return { ok: false, code: "invalid_payee", plain: r.error };
  }

  let capture: CaptureFacts | null = null;
  if (claim.linkedCaptureId) {
    const p = await hasPriorRefund(claim.linkedCaptureId, deps);
    capture = { id: claim.linkedCaptureId, found: p.found, capturedAt: p.capturedAt, remainingCents: p.remainingCents, refunded: p.refunded, disputed: p.disputes.count > 0 };
  }
  const now = deps.now();
  const choice = chooseRoute({ choice: claim.choice, capture, replacement: claim.replacement ?? null, payee: claim.payee, now });
  if (!choice.route) return { ok: false, code: "no_route", plain: choice.plain };

  const amountCents =
    choice.route === "refund" ? Math.min(claim.amountCents, capture!.remainingCents) : choice.route === "replacement" ? claim.replacement!.priceCents : claim.amountCents;
  if (amountCents > LIMITS.perPaymentCents) return { ok: false, code: "over_limit", plain: `Sandbox demo payments are limited to ${usd(LIMITS.perPaymentCents)} each.` };

  // The auto rule: a verified claim at or under the firm's cap, with nothing for a person to weigh.
  const cap = opts.autoCapCents ?? LIMITS.perPaymentCents;
  const capturedConcern = Boolean(capture && (capture.refunded || capture.disputed || !capture.found));
  const replacementOverRefund = choice.route === "replacement" && amountCents > claim.amountCents;
  const auto = claim.decision === "verified" && amountCents <= cap && !capturedConcern && !replacementOverRefund;
  const approval: Approval | null = auto ? { by: "auto_rule", who: "auto rule", rule: `verified and ${usd(amountCents)} is at or under ${usd(cap)}`, at: now.toISOString() } : null;

  const venmoNote = claim.payee?.type === "venmo" && choice.route === "payout" ? " Venmo payouts need live PayPal; in this sandbox demo the money goes to the PayPal account for that phone number." : "";
  const plan: PaymentPlan = {
    id: `plan_${claim.claimId}`.slice(0, 80),
    claimId: claim.claimId,
    firmId: claim.firmId ?? deps.firm.id,
    recallNumber: claim.recallNumber,
    recallTitle: claim.recallTitle,
    route: choice.route,
    amountCents,
    currency: "USD",
    payee: choice.route === "payout" ? claim.payee : null,
    captureId: choice.route === "refund" ? capture!.id : null,
    replacement: choice.route === "replacement" ? claim.replacement! : null,
    reasons: { plain: choice.plain + venmoNote, technical: choice.technical },
    approval,
    status: auto ? "approved" : "awaiting_approval",
    attempt: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  // A canceled plan keeps its id; a new plan for the same claim gets the next suffix.
  if (existing) plan.id = `${plan.id}_${Date.parse(now.toISOString()).toString(36)}`;
  const saved = await deps.store.insertPlan(plan);
  if (saved.created) {
    await deps.ledger("system", "payment.plan_created", `claim:${claim.claimId}`, {
      plan: saved.plan.id,
      route: saved.plan.route,
      amount_cents: saved.plan.amountCents,
      approval: saved.plan.approval?.by ?? "awaiting_reviewer",
      rule: saved.plan.approval?.rule ?? null,
      capture: saved.plan.captureId,
    });
  }
  return { ok: true, plan: saved.plan, created: saved.created };
}

/** A reviewer approves a plan that the auto rule left for a person. */
export async function approvePlan(planId: string, reviewer: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const who = reviewer.trim().slice(0, 80) || "reviewer";
  const plan = await deps.store.transitionPlan(planId, ["awaiting_approval"], "approved", { approval: { by: "reviewer", who, at: deps.now().toISOString() } });
  if (!plan) return { ok: false as const, plan: await deps.store.getPlan(planId) };
  await deps.ledger("person", "payment.plan_approved", `claim:${plan.claimId}`, { plan: plan.id, by: "reviewer", who });
  return { ok: true as const, plan };
}

export async function cancelPlan(planId: string, by: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const plan = await deps.store.transitionPlan(planId, ["awaiting_approval", "approved"], "canceled");
  if (plan) await deps.ledger("person", "payment.plan_canceled", `claim:${plan.claimId}`, { plan: plan.id, by: by.slice(0, 80) });
  return plan;
}

/** After a definite failure (or a returned payout), a reviewer can start a new attempt with new idempotency keys. */
export async function retryPlan(planId: string, reviewer: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const current = await deps.store.getPlan(planId);
  if (!current || current.status !== "failed") return { ok: false as const, plan: current };
  const plan = await deps.store.transitionPlan(planId, ["failed"], "approved", {
    attempt: current.attempt + 1,
    approval: { by: "reviewer", who: reviewer.slice(0, 80) || "reviewer", rule: "retry", at: deps.now().toISOString() },
  });
  if (!plan) return { ok: false as const, plan: await deps.store.getPlan(planId) };
  await deps.ledger("person", "payment.plan_retried", `claim:${plan.claimId}`, { plan: plan.id, attempt: plan.attempt });
  return { ok: true as const, plan };
}

export type PayResult =
  | { kind: "sent"; plan: PaymentPlan; payment: PaymentRecord; plain: string }
  | { kind: "already"; plan: PaymentPlan; payment: PaymentRecord | null; plain: string }
  | { kind: "needs_approval"; plan: PaymentPlan; plain: string }
  | { kind: "failed"; plan: PaymentPlan; payment: PaymentRecord; issue: string; plain: string; debugId: string | null }
  | { kind: "retry_later"; plan: PaymentPlan; plain: string }
  | { kind: "limit" | "not_found" | "not_payable"; plain: string };

/** The payment's unique request id. For refunds and replacements it is also the PayPal-Request-Id. */
export const requestIdFor = (plan: Pick<PaymentPlan, "route" | "claimId" | "attempt">) => `${plan.route === "replacement" ? "replace" : plan.route}-${plan.claimId}-a${plan.attempt}`;

function newPayment(plan: PaymentPlan, now: Date, extra: Partial<PaymentRecord>): PaymentRecord {
  const at = now.toISOString();
  return {
    id: paymentIdFor(plan.id, plan.attempt),
    planId: plan.id,
    claimId: plan.claimId,
    attempt: plan.attempt,
    requestId: requestIdFor(plan),
    firmId: plan.firmId,
    route: plan.route,
    amountCents: plan.amountCents,
    currency: "USD",
    status: "sending",
    paypalStatus: null,
    payeeType: plan.payee?.type ?? null,
    senderBatchId: null,
    senderItemId: null,
    payoutBatchId: null,
    payoutItemId: null,
    transactionId: null,
    captureId: plan.captureId,
    refundId: null,
    orderId: null,
    debugId: null,
    issue: null,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

/** Load a plan and claim it for execution, or say why it cannot run now. */
async function claimForExecution(planId: string, deps: PaymentsDeps): Promise<{ plan: PaymentPlan } | PayResult> {
  const plan = await deps.store.getPlan(planId);
  if (!plan) return { kind: "not_found", plain: "There is no payment plan for this claim yet." };
  const already = async (p: PaymentPlan): Promise<PayResult> => {
    const payment = await deps.store.getPaymentByPlan(p.id, p.attempt);
    return { kind: "already", plan: p, payment, plain: payment ? describeStatus(payment.status, payment.route).plain : "This payment is already being sent." };
  };
  if (plan.status === "executing" || plan.status === "submitted" || plan.status === "paid") return already(plan);
  if (plan.status === "awaiting_approval") return { kind: "needs_approval", plan, plain: "This payment is waiting for a person at the firm to approve it." };
  if (plan.status !== "approved") return { kind: "not_payable", plain: plan.status === "failed" ? "The last try did not go through. A reviewer can try again." : "This payment plan was canceled." };

  const since = new Date(deps.now().getTime() - 86_400_000);
  if ((await deps.store.sumPaymentsSince(since)) + plan.amountCents > LIMITS.perDayCents) return { kind: "limit", plain: "The sample firm reached its sandbox payout limit for today. Please try again tomorrow." };

  // The one compare-and-set: only one caller moves approved to executing. Everyone else reads what that caller did.
  const claimed = await deps.store.transitionPlan(plan.id, ["approved"], "executing");
  if (!claimed) return already((await deps.store.getPlan(plan.id)) ?? plan);
  return { plan: claimed };
}

/** Run an approved plan once. A second call, at the same time or later, returns the first call's payment. */
export async function executePlan(planId: string, partial?: Partial<PaymentsDeps>): Promise<PayResult> {
  const deps = await resolveDeps(partial);
  const got = await claimForExecution(planId, deps);
  if ("kind" in got) return got;
  const plan = got.plan;
  if (plan.route === "payout") return (await sendPayoutBatch([plan], deps))[0];
  if (plan.route === "refund") return runRefund(plan, deps);
  return runReplacement(plan, deps);
}

/** Pay a claim by its id: the plan must already exist (planPayment) and be approved. */
export async function payClaim(claimId: string, partial?: Partial<PaymentsDeps>): Promise<PayResult> {
  const deps = await resolveDeps(partial);
  const plan = await deps.store.getPlanByClaim(claimId);
  if (!plan) return { kind: "not_found", plain: "There is no payment plan for this claim yet." };
  return executePlan(plan.id, deps);
}

/**
 * Bulk "Approve and pay": every approved payout plan goes into one Payouts batch (one item per claim); refunds and
 * replacements run one by one. Plans another call is already paying are reported as "already" and not resent.
 */
export async function payClaims(claimIds: string[], partial?: Partial<PaymentsDeps>): Promise<{ claimId: string; result: PayResult }[]> {
  const deps = await resolveDeps(partial);
  const ids = [...new Set(claimIds)].slice(0, LIMITS.bulkClaims);
  const out: { claimId: string; result: PayResult }[] = [];
  const payouts: PaymentPlan[] = [];
  for (const claimId of ids) {
    const plan = await deps.store.getPlanByClaim(claimId);
    if (!plan) {
      out.push({ claimId, result: { kind: "not_found", plain: "There is no payment plan for this claim yet." } });
      continue;
    }
    const got = await claimForExecution(plan.id, deps);
    if ("kind" in got) out.push({ claimId, result: got });
    else if (got.plan.route === "payout") payouts.push(got.plan);
    else out.push({ claimId, result: got.plan.route === "refund" ? await runRefund(got.plan, deps) : await runReplacement(got.plan, deps) });
  }
  if (payouts.length) {
    const results = await sendPayoutBatch(payouts, deps);
    payouts.forEach((p, i) => out.push({ claimId: p.claimId, result: results[i] }));
  }
  return ids.map((id) => out.find((o) => o.claimId === id)!).filter(Boolean);
}

async function sendPayoutBatch(plans: PaymentPlan[], deps: PaymentsDeps): Promise<PayResult[]> {
  const now = deps.now();
  const senderBatchId = senderBatchIdFor(plans.map((p) => ({ claimId: p.claimId, attempt: p.attempt })));
  const rows: PaymentRecord[] = [];
  for (const plan of plans) {
    const { payment } = await deps.store.insertPayment(newPayment(plan, now, { senderBatchId, senderItemId: senderItemIdFor(plan.claimId) }));
    rows.push(payment);
  }
  const lines: PayoutLine[] = plans.map((p) => ({ claimId: p.claimId, amountCents: p.amountCents, payee: p.payee!, recallNumber: p.recallNumber, recallTitle: p.recallTitle }));
  const r = await createPayoutBatch(lines, { senderBatchId }, deps);

  if (!r.ok && !r.definite) {
    // PayPal did not answer clearly. Put the plans back as approved with the same attempt: the next "pay" sends the
    // same sender_batch_id and PayPal-Request-Id, so PayPal returns this batch if it was made, or makes it once.
    return Promise.all(
      plans.map(async (p, i) => {
        await deps.store.updatePayment(rows[i].id, { issue: r.issue, debugId: r.debugId });
        const back = (await deps.store.transitionPlan(p.id, ["executing"], "approved")) ?? p;
        return { kind: "retry_later", plan: back, plain: "PayPal did not answer in time. Nothing was sent twice; please try again in a minute." } as PayResult;
      }),
    );
  }
  if (!r.ok) {
    return Promise.all(
      plans.map(async (p, i) => {
        const failedRow = (await deps.store.updatePayment(rows[i].id, { status: "failed", issue: r.issue, debugId: r.debugId, paypalStatus: "DENIED" })) ?? rows[i];
        const failedPlan = (await deps.store.transitionPlan(p.id, ["executing"], "failed")) ?? p;
        await deps.ledger("system", "paypal.payout.refused", `claim:${p.claimId}`, { plan: p.id, issue: r.issue, sender_batch_id: senderBatchId, debug_id: r.debugId });
        return { kind: "failed", plan: failedPlan, payment: failedRow, issue: r.issue, plain: r.plain, debugId: r.debugId } as PayResult;
      }),
    );
  }

  await deps.store.addPlanTask({
    key: `payout-batch:${r.payoutBatchId}`,
    firmId: plans[0].firmId,
    recallNumber: plans[0].recallNumber,
    kind: "payout_batch",
    source: "system",
    name: `Payout batch, ${plans.length} ${plans.length === 1 ? "refund" : "refunds"}`,
    startDate: now.toISOString().slice(0, 10),
    durationDays: 1,
    dependsOn: null,
    data: { payoutBatchId: r.payoutBatchId, senderBatchId: r.senderBatchId, claims: plans.map((p) => p.claimId), totalCents: plans.reduce((s, p) => s + p.amountCents, 0) },
  });
  await deps.store.addPlanTask({
    key: `unclaimed-follow-up:${r.payoutBatchId}`,
    firmId: plans[0].firmId,
    recallNumber: plans[0].recallNumber,
    kind: "follow_up",
    source: "system",
    name: "Follow-up on payouts waiting to be accepted (batch plus 30 days)",
    startDate: new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
    durationDays: 1,
    dependsOn: `payout-batch:${r.payoutBatchId}`,
    data: { payoutBatchId: r.payoutBatchId },
  });
  return Promise.all(
    plans.map(async (p, i) => {
      const row =
        (await deps.store.updatePayment(rows[i].id, { payoutBatchId: r.payoutBatchId, senderBatchId: r.senderBatchId, paypalStatus: r.batchStatus, debugId: r.debugId, issue: r.walletFallback && p.payee?.type === "venmo" ? "VENMO_SANDBOX_FALLBACK" : null })) ??
        rows[i];
      const sent = (await deps.store.transitionPlan(p.id, ["executing"], "submitted")) ?? p;
      await deps.ledger("system", "paypal.payout.created", `claim:${p.claimId}`, {
        plan: p.id,
        payout_batch_id: r.payoutBatchId,
        sender_batch_id: r.senderBatchId,
        sender_item_id: row.senderItemId,
        amount_cents: p.amountCents,
        recipient: p.payee?.type,
        wallet_fallback: r.walletFallback,
        existing_batch: r.existing,
      });
      return { kind: "sent", plan: sent, payment: row, plain: describeStatus("sending").plain } as PayResult;
    }),
  );
}

async function finishSingle(
  plan: PaymentPlan,
  row: PaymentRecord,
  r: { ok: true; status: PaymentStatus; paypalStatus: string; ids: Partial<PaymentRecord>; ledger: string; detail: Record<string, unknown> } | { ok: false; definite: boolean; issue: string; plain: string; debugId: string | null },
  deps: PaymentsDeps,
): Promise<PayResult> {
  if (!r.ok && !r.definite) {
    await deps.store.updatePayment(row.id, { issue: r.issue, debugId: r.debugId });
    const back = (await deps.store.transitionPlan(plan.id, ["executing"], "approved")) ?? plan;
    return { kind: "retry_later", plan: back, plain: "PayPal did not answer in time. Nothing was sent twice; please try again in a minute." };
  }
  if (!r.ok) {
    const failedRow = (await deps.store.updatePayment(row.id, { status: "failed", issue: r.issue, debugId: r.debugId })) ?? row;
    const failedPlan = (await deps.store.transitionPlan(plan.id, ["executing"], "failed")) ?? plan;
    await deps.ledger("system", `paypal.${plan.route}.refused`, `claim:${plan.claimId}`, { plan: plan.id, issue: r.issue, debug_id: r.debugId });
    return { kind: "failed", plan: failedPlan, payment: failedRow, issue: r.issue, plain: r.plain, debugId: r.debugId };
  }
  const withIds = (await deps.store.updatePayment(row.id, { ...r.ids })) ?? { ...row, ...r.ids };
  await deps.store.transitionPlan(plan.id, ["executing"], "submitted");
  await deps.ledger("system", r.ledger, `claim:${plan.claimId}`, { plan: plan.id, amount_cents: plan.amountCents, ...r.detail });
  const final = await recordStatus(withIds, r.status, { paypalStatus: r.paypalStatus }, "pay", deps);
  return { kind: "sent", plan: (await deps.store.getPlan(plan.id)) ?? plan, payment: final.payment, plain: describeStatus(final.payment.status, plan.route).plain };
}

async function runRefund(plan: PaymentPlan, deps: PaymentsDeps): Promise<PayResult> {
  const { payment: row } = await deps.store.insertPayment(newPayment(plan, deps.now(), {}));
  const r = await refundCapture(
    { captureId: plan.captureId!, amountCents: plan.amountCents, requestId: requestIdFor(plan), noteToPayer: `Recall refund for ${plan.recallTitle} (${recallLabel(plan.recallNumber)}). Thank you for making it safe.` },
    deps,
  );
  return finishSingle(
    plan,
    row,
    r.ok ? { ok: true, status: r.status, paypalStatus: r.paypalStatus, ids: { refundId: r.refundId, debugId: r.debugId }, ledger: "paypal.refund.created", detail: { capture: plan.captureId, refund: r.refundId, paypal_status: r.paypalStatus } } : r,
    deps,
  );
}

async function runReplacement(plan: PaymentPlan, deps: PaymentsDeps): Promise<PayResult> {
  const { payment: row } = await deps.store.insertPayment(newPayment(plan, deps.now(), {}));
  const r = await payReplacement({ claimId: plan.claimId, requestId: requestIdFor(plan), recallNumber: plan.recallNumber, replacement: plan.replacement! }, deps);
  return finishSingle(
    plan,
    row,
    r.ok
      ? {
          ok: true,
          status: r.status,
          paypalStatus: r.paypalStatus,
          ids: { orderId: r.orderId, transactionId: r.captureId, debugId: r.debugId },
          ledger: "paypal.replacement.ordered",
          detail: { order: r.orderId, capture: r.captureId, product: plan.replacement?.productId, retailer: plan.replacement?.retailer },
        }
      : r,
    deps,
  );
}

/** Everything a claim page or the firm console needs to show a claim's payment, in plain and technical words. */
export async function paymentSummary(claimId: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const plan = await deps.store.getPlanByClaim(claimId);
  const payment = plan ? await deps.store.getPaymentByPlan(plan.id, plan.attempt) : null;
  return {
    plan,
    payment,
    status: payment ? describeStatus(payment.status, payment.route) : null,
    payee: plan?.payee ? { type: plan.payee.type, masked: maskPayee(plan.payee) } : null,
  };
}

/** "j***n@example.com" or "***-***-0123": enough to recognize, not enough to reuse. */
export function maskPayee(p: Payee) {
  if (p.type === "email") {
    const e = normalizeEmail(p.value) ?? p.value;
    const [user, domain] = e.split("@");
    return `${user.slice(0, 1)}***${user.length > 1 ? user.slice(-1) : ""}@${domain ?? ""}`;
  }
  const d = normalizeUsPhone(p.value) ?? p.value.replace(/\D/g, "");
  return `***-***-${d.slice(-4)}`;
}
