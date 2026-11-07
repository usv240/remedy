/**
 * The claims queue: every claim the firm has, with its checks, decision and payment, read in one query, and the two
 * things a reviewer does with a claim: approve and pay it, or ask for a new photo. Server only.
 *
 * The money is the payments engine's (src/lib/payments): this file builds each claim's PaymentPlan with planPayment,
 * approves it in the reviewer's name when the auto rule left it for a person, and pays the lot with payClaims, which
 * puts every payout into one PayPal Payouts batch. Nothing here moves money on its own.
 */
import { sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { approvePlan, cancelPlan, describeStatus, payClaims, planPayment, type ClaimForPayment, type PayResult } from "@/lib/payments";
import { refundWindow } from "@/lib/payments/refunds";
import type { PaymentStatus } from "@/lib/payments/types";
import { decrypt } from "@/lib/secure";
import type { CheckId, Checks } from "@/lib/verify/types";
import { CHECK_LABEL, CHECK_ORDER, checkWords, confidence } from "./checks";
import { recallThumb, shortName, type Firm } from "./firm";
import { ensureReadyClaims } from "./sample-claims";
import type { ClaimDetail, Decision, PayStatus, QueueRow, Review, Stage } from "./types";

type Raw = {
  id: string;
  recall_number: string;
  title: string;
  products: { name?: string }[] | null;
  photo_id: string | null;
  /** Whether the photo's bytes are still stored, and why they were deleted when not (person | retention). */
  photo_kept: boolean | null;
  photo_removed: string | null;
  payee_type: "email" | "phone" | "venmo" | null;
  payee_masked: string | null;
  has_payee: boolean;
  checks: Partial<Checks> | null;
  decision: Decision;
  status: string;
  review_outcome: "approved" | "retake" | "declined" | null;
  amount: string | null;
  channel: string;
  created_at: Date | string;
  is_sample: boolean;
  plan_id: number | null;
  plan_status: string | null;
  pay_status: string | null;
  pay_route: "refund" | "payout" | "replacement" | null;
  paid_at: Date | string | null;
  paypal_batch_id: string | null;
  paypal_item_id: string | null;
  paypal_status: string | null;
  issue: string | null;
  capture_id: string | null;
};

/** claim.result, as the claim route stores the verifier's answer (src/app/api/claims/_lib/claims.ts). */
type StoredResult = {
  decided_by?: string;
  summary?: { plain: string; technical: string };
  guidance?: { plain: string; steps: string[]; technical: string } | null;
  model?: string | null;
  timings?: { total_ms?: number };
  quality?: { ok: boolean; issues: string[] };
};

const iso = (d: Date | string | null) => (d === null ? null : typeof d === "string" ? new Date(d).toISOString() : d.toISOString());
const cents = (v: string | null) => (v === null ? null : Math.round(Number(v) * 100));

/** payment.status in Postgres to the engine's words (src/lib/payments/pg-store.ts keeps the same mapping). */
export function payFromDb(s: string, route: string): PayStatus {
  if (s === "pending") return "sending";
  if (s === "success") return "paid";
  if (s === "refunded") return route === "refund" ? "paid" : "reversed";
  if (s === "onhold") return "on_hold";
  return s as PayStatus;
}

/** Seeded sample payments carry paypal_status SAMPLE: no PayPal call was made for them. */
export const SAMPLE_PAYPAL_STATUS = "SAMPLE";

/** Where a claim stands for the firm. The payment, when there is one, is the truth; then the review; then the checks. */
export function stageOf(r: { decision: Decision; reviewOutcome: Raw["review_outcome"]; pay: PayStatus | null; hasAmount: boolean; hasPayee: boolean }): Stage {
  if (r.reviewOutcome === "declined") return "declined";
  if (r.reviewOutcome === "retake" || (r.decision === "retake" && !r.pay)) return "retake";
  if (r.pay) {
    if (r.pay === "paid") return "paid";
    if (r.pay === "sending" || r.pay === "on_hold") return "sending";
    if (r.pay === "unclaimed" || r.pay === "returned") return "unclaimed";
    if (r.pay === "canceled" || r.pay === "reversed") return "closed";
    return "needs_review"; // failed or blocked: a person picks another way to pay
  }
  if (r.decision === "pending") return "checking";
  if (r.decision === "firm_review" && r.reviewOutcome !== "approved") return "needs_review";
  return r.hasAmount && r.hasPayee ? "ready" : "needs_review";
}

const QUEUE_SQL = (firmId: number, where = sql`true`) => sql`
  select c.id, c.recall_number, r.title, r.products, c.photo_id, (ph.bytes is not null) as photo_kept, ph.removed_reason as photo_removed, c.payee_type, c.payee_masked, (c.payee_value_enc is not null) as has_payee,
         c.checks, c.decision, c.status, c.review_outcome, c.amount::text as amount, c.channel, c.created_at, c.is_sample,
         pp.id as plan_id, coalesce(pp.detail->>'status', pp.status) as plan_status,
         p.status as pay_status, p.route as pay_route, p.paid_at, p.paypal_batch_id, p.paypal_item_id, p.paypal_status, p.error->>'issue' as issue,
         s.paypal_capture_id as capture_id
  from claim c
  join recall r on r.number = c.recall_number
  left join photo ph on ph.id = c.photo_id
  left join payment_plan pp on pp.claim_id = c.id
  left join lateral (select * from payment x where x.claim_id = c.id order by x.id desc limit 1) p on true
  left join sale s on s.id = c.linked_sale_id
  where c.firm_id = ${firmId} and ${where}
  order by c.created_at desc
  limit 500`;

function toRow(r: Raw): QueueRow {
  const pay = r.pay_status && r.pay_route ? payFromDb(r.pay_status, r.pay_route) : null;
  const amountCents = cents(r.amount);
  const sample = r.is_sample && r.paypal_status === SAMPLE_PAYPAL_STATUS;
  const hasPayee = r.has_payee || Boolean(r.capture_id);
  const stage = stageOf({ decision: r.decision, reviewOutcome: r.review_outcome, pay, hasAmount: (amountCents ?? 0) > 0, hasPayee });
  const planOpen = !r.plan_status || ["awaiting_approval", "approved", "planned", "canceled"].includes(r.plan_status);
  return {
    id: r.id,
    recallNumber: r.recall_number,
    recallShort: shortName(r.title, r.products),
    photoUrl: r.photo_id && r.photo_kept ? `/api/firm/claims/${r.id}/photo` : null,
    photoRemoved: r.photo_removed === "person" || r.photo_removed === "retention" ? r.photo_removed : null,
    claimant: r.payee_masked ?? "No contact yet",
    payeeType: r.payee_type,
    checks: checkWords(r.checks),
    confidence: confidence(r.checks),
    decision: r.decision,
    stage,
    reviewOutcome: r.review_outcome,
    amountCents,
    payout: {
      status: pay,
      label: pay ? (sample ? `${describeStatus(pay as PaymentStatus, r.pay_route ?? "payout").label} (sample)` : describeStatus(pay as PaymentStatus, r.pay_route ?? "payout").label) : "Not paid yet",
      route: r.pay_route,
      sample,
      paidAt: iso(r.paid_at),
      batchId: r.paypal_batch_id,
      itemId: r.paypal_item_id,
    },
    channel: r.channel,
    submittedAt: iso(r.created_at)!,
    sample: r.is_sample,
    payable: stage === "ready" && planOpen && (amountCents ?? 0) > 0 && hasPayee,
  };
}

const run = async <T>(q: ReturnType<typeof sql>) => (await db().execute(q)).rows as T[];

export async function queueRows(firmId: number): Promise<QueueRow[]> {
  return (await run<Raw>(QUEUE_SQL(firmId))).map(toRow);
}

async function rawClaim(firmId: number, claimId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(claimId)) return null;
  const [r] = await run<Raw>(QUEUE_SQL(firmId, sql`c.id = ${claimId}::uuid`));
  return r ?? null;
}

/** A note on what kind of claim this is, for the drawer. */
function noteFor(r: Raw, extra: { recorded: boolean }) {
  if (extra.recorded) return "Sample claim. The photo is the CPSC's own made-safe example for recall 26125 (a different hair dryer), checked live once against this recall by Claude and recorded.";
  if (r.is_sample && r.paypal_status === SAMPLE_PAYPAL_STATUS) return "Sample history (not paid). Seeded so the console is not empty; no money moved for this claim.";
  if (r.is_sample && r.amount === "1.00") return "Sample claim ready to pay, at $1.00 so live sandbox payouts stay small. Paying it sends a real PayPal sandbox payout to the sandbox buyer, and two new sample claims take its place.";
  if (r.is_sample) return "Sample claim, seeded for the demo. Paying it sends a real PayPal sandbox payout.";
  return null;
}

export async function claimDetail(firm: Firm, claimId: string): Promise<ClaimDetail | null> {
  const r = await rawClaim(firm.id, claimId);
  if (!r) return null;
  const row = toRow(r);
  const [extra] = await run<{
    url: string;
    units: number | null;
    rule: Record<string, unknown> | null;
    rule_source: string | null;
    debate: Review | null;
    reviewed_by: string | null;
    reviewed_at: Date | null;
    photo_source: string | null;
    paid_at: Date | null;
    result: StoredResult | null;
  }>(sql`
    select r.url, r.units, pr.rule, pr.source as rule_source, c.debate, c.reviewed_by, c.reviewed_at, ph.source as photo_source, s.paid_at, c.result
    from claim c join recall r on r.number = c.recall_number
    left join lateral (select rule, source from proof_rule where recall_number = c.recall_number order by version desc limit 1) pr on true
    left join photo ph on ph.id = c.photo_id
    left join sale s on s.id = c.linked_sale_id
    where c.id = ${claimId}::uuid`);
  const rule = extra?.rule as { steps?: string[]; actions?: string[]; must_show?: string[]; explanation?: { plain?: string } } | null;
  const checks = CHECK_ORDER.map((id: CheckId) => {
    const c = r.checks?.[id];
    return {
      id,
      name: CHECK_LABEL[id].long,
      status: row.checks[id],
      plain: c?.reason_plain ?? "Not checked yet.",
      technical: c?.reason_technical ?? "",
      score: typeof c?.score === "number" ? c.score : null,
    };
  });

  // The plan, or what approving would do. The route rule is the engine's (chooseRoute): a linked PayPal purchase
  // inside 180 days is refunded to that capture; otherwise a Payouts item to the owner's email or phone.
  const [plan] = r.plan_id
    ? await run<{ route: string; amount: string; approval: string | null; approved_by: string | null; detail: { status?: string; reasons?: { plain: string; technical: string }; payee?: { masked?: string } } }>(
        sql`select route, amount::text as amount, approval, approved_by, detail from payment_plan where id = ${r.plan_id}`,
      )
    : [];
  let planView: ClaimDetail["plan"];
  if (plan) {
    planView = {
      exists: true,
      route: plan.route as "refund" | "payout" | "replacement",
      amountCents: cents(plan.amount),
      payee: plan.detail?.payee?.masked ?? row.claimant,
      approval: plan.approval === "auto" ? "Approved by the firm's auto rule" : plan.approved_by ? `Approved by ${plan.approved_by}` : "Waiting for a person at the firm",
      status: plan.detail?.status ?? null,
      plain: plan.detail?.reasons?.plain ?? "",
      technical: plan.detail?.reasons?.technical ?? "",
    };
  } else {
    const paidAt = extra?.paid_at ? new Date(extra.paid_at).toISOString() : null;
    const refund = r.capture_id && paidAt ? refundWindow(paidAt, new Date()) : null;
    const viaRefund = Boolean(refund?.within);
    planView = {
      exists: false,
      route: viaRefund ? "refund" : r.has_payee ? "payout" : null,
      amountCents: row.amountCents,
      payee: viaRefund ? "The PayPal payment they bought it with" : r.has_payee ? row.claimant : null,
      approval: null,
      status: null,
      plain: viaRefund
        ? `They paid with PayPal ${refund!.ageDays} days ago, so the refund goes back to that same payment.`
        : r.has_payee
          ? `A PayPal payout to ${row.payeeType === "phone" || row.payeeType === "venmo" ? "the phone number" : "the email"} they gave.`
          : "No email or phone yet, so there is nowhere to send the refund.",
      technical: viaRefund ? `POST /v2/payments/captures/${r.capture_id}/refund (linked capture, ${refund!.ageDays} d of 180).` : r.has_payee ? `POST /v1/payments/payouts, one item, recipient_type ${row.payeeType === "email" ? "EMAIL" : "PHONE"}.` : "No route.",
    };
  }

  const pay = row.payout.status;
  return {
    row,
    recall: { number: r.recall_number, title: r.title, image: recallThumb(r.recall_number), units: extra?.units ?? null, url: extra?.url ?? "" },
    rule: rule ? { steps: rule.steps ?? [], actions: rule.actions ?? [], mustShow: rule.must_show ?? [], plain: rule.explanation?.plain ?? null, source: extra?.rule_source ?? null } : null,
    checks,
    review: (extra?.debate as Review | null) ?? null,
    plan: planView,
    payment: pay
      ? { status: pay, plain: describeStatus(pay as PaymentStatus, r.pay_route ?? "payout").plain, batchId: r.paypal_batch_id, itemId: r.paypal_item_id, paypalStatus: r.paypal_status, issue: r.issue, sample: row.payout.sample }
      : null,
    verdict: extra?.result
      ? {
          decidedBy: extra.result.decided_by ?? null,
          summary: extra.result.summary ?? null,
          guidance: extra.result.guidance ?? null,
          model: extra.result.model ?? null,
          totalMs: extra.result.timings?.total_ms ?? null,
          quality: extra.result.quality ?? null,
        }
      : null,
    note: noteFor(r, { recorded: extra?.photo_source === "preset" }),
    reviewedBy: extra?.reviewed_by ?? null,
    reviewedAt: extra?.reviewed_at ? new Date(extra.reviewed_at).toISOString() : null,
  };
}

/** The claim as the payments engine takes it, with the payee decrypted only here, on the server. */
async function forPayment(firm: Firm, claimId: string) {
  const [c] = await run<{
    id: string;
    recall_number: string;
    title: string;
    decision: Decision;
    review_outcome: string | null;
    amount: string | null;
    payee_type: "email" | "phone" | "venmo" | null;
    payee_value_enc: string | null;
    capture_id: string | null;
    auto_cap: string | null;
  }>(sql`
    select c.id, c.recall_number, r.title, c.decision, c.review_outcome, c.amount::text as amount, c.payee_type, c.payee_value_enc,
           s.paypal_capture_id as capture_id, fr.auto_cap::text as auto_cap
    from claim c join recall r on r.number = c.recall_number
    left join sale s on s.id = c.linked_sale_id
    left join firm_recall fr on fr.firm_id = c.firm_id and fr.recall_number = c.recall_number
    where c.id = ${claimId}::uuid and c.firm_id = ${firm.id}`);
  return c ?? null;
}

export type PayOutcome = { claimId: string; ok: boolean; kind: PayResult["kind"] | "skipped"; plain: string; batchId: string | null };

/**
 * "Approve and pay": plan each claim, approve it in the reviewer's name where the auto rule left it for a person, then
 * pay them together. A claim in firm review is paid only when `reviewed` is set (one claim, from its drawer, after a
 * person looked). Safe to repeat: the engine keeps one plan per claim and never pays a claim twice.
 */
export async function approveAndPay(firm: Firm, claimIds: string[], reviewer: string, opts: { reviewed?: boolean } = {}): Promise<PayOutcome[]> {
  const who = reviewer.trim().slice(0, 80) || "Firm reviewer";
  const out: PayOutcome[] = [];
  const toPay: string[] = [];
  for (const id of [...new Set(claimIds)].slice(0, 25)) {
    const c = /^[0-9a-f-]{36}$/i.test(id) ? await forPayment(firm, id) : null;
    if (!c) {
      out.push({ claimId: id, ok: false, kind: "not_found", plain: "This claim was not found.", batchId: null });
      continue;
    }
    if (c.decision === "retake" || c.review_outcome === "retake" || c.review_outcome === "declined" || c.decision === "pending") {
      out.push({ claimId: id, ok: false, kind: "skipped", plain: "This claim needs a new photo before it can be paid.", batchId: null });
      continue;
    }
    if (c.decision === "firm_review" && c.review_outcome !== "approved" && !opts.reviewed) {
      out.push({ claimId: id, ok: false, kind: "skipped", plain: "Open this claim and review it before paying.", batchId: null });
      continue;
    }
    let payee: ClaimForPayment["payee"] = null;
    if (c.payee_type && c.payee_value_enc) {
      try {
        payee = { type: c.payee_type, value: decrypt(c.payee_value_enc) };
      } catch {
        payee = null;
      }
    }
    const claim: ClaimForPayment = {
      claimId: c.id,
      recallNumber: c.recall_number,
      recallTitle: c.title,
      firmId: String(firm.id),
      decision: c.decision === "firm_review" ? "firm_review" : "verified",
      amountCents: cents(c.amount) ?? 0,
      payee,
      choice: "money",
      linkedCaptureId: c.capture_id,
    };
    const planned = await planPayment(claim, { autoCapCents: c.auto_cap ? Math.round(Number(c.auto_cap) * 100) : undefined });
    if (!planned.ok) {
      out.push({ claimId: id, ok: false, kind: "not_payable", plain: planned.plain, batchId: null });
      continue;
    }
    if (planned.plan.status === "awaiting_approval") {
      const a = await approvePlan(planned.plan.id, who);
      if (!a.ok && a.plan?.status === "awaiting_approval") {
        out.push({ claimId: id, ok: false, kind: "needs_approval", plain: "This payment could not be approved just now.", batchId: null });
        continue;
      }
    }
    if (c.decision === "firm_review") {
      await db().execute(sql`update claim set review_outcome = 'approved', reviewed_by = ${who}, reviewed_at = now(), status = 'approved', updated_at = now() where id = ${id}::uuid`);
      await audit("person", "claim.review_approved", `claim:${id}`, { by: who });
    }
    toPay.push(id);
  }

  if (toPay.length) {
    const results = await payClaims(toPay);
    for (const { claimId, result } of results) {
      const payment = "payment" in result ? result.payment : null;
      const ok = result.kind === "sent" || result.kind === "already";
      out.push({ claimId, ok, kind: result.kind, plain: result.plain, batchId: payment?.payoutBatchId ?? null });
      if (ok) await db().execute(sql`update claim set status = 'approved', updated_at = now() where id = ${claimId}::uuid and status in ('verified', 'firm_review', 'approved')`);
    }
    await audit("person", "firm.approve_and_pay", `firm:${firm.id}`, { by: who, claims: toPay.length, sent: out.filter((o) => o.kind === "sent").length });
    // The sample claims ready to pay were just used: add the next two, so the next visitor can pay too.
    await ensureReadyClaims(firm.id).catch(() => 0);
  }
  return claimIds.map((id) => out.find((o) => o.claimId === id)!).filter(Boolean);
}

/** The friendly note an owner gets when the firm asks for one more photo. */
export function retakeMessage(o: { firmName: string; product: string; steps: string[]; note?: string | null }) {
  const lines = [
    `Thank you for sending a photo of your ${o.product}. Could you take one more?`,
    o.note?.trim() ? o.note.trim() : null,
    o.steps.length ? `What helps: ${o.steps.slice(0, 3).join(" ")}` : null,
    `Use the same link to send it. Your refund comes as soon as it checks out. From the ${o.firmName} recall team.`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** "Ask for a retake": mark the claim, cancel any plan not yet paid, and queue a friendly message (sending is a stub). */
export async function askForRetake(firm: Firm, claimId: string, reviewer: string, note?: string | null) {
  const r = await rawClaim(firm.id, claimId);
  if (!r) return { ok: false as const, plain: "This claim was not found." };
  if (r.pay_status && r.pay_status !== "failed") return { ok: false as const, plain: "This claim is already being paid, so a new photo is not needed." };
  const who = reviewer.trim().slice(0, 80) || "Firm reviewer";
  const [rule] = await run<{ steps: string[] | null }>(sql`select rule->'steps' as steps from proof_rule where recall_number = ${r.recall_number} order by version desc limit 1`);
  const steps = (rule?.steps ?? []).filter((s) => !/email|send|dispose|throw/i.test(s));
  const message = retakeMessage({ firmName: firm.name, product: shortName(r.title, r.products).toLowerCase(), steps, note: note?.slice(0, 400) });
  if (r.plan_id) {
    const [p] = await run<{ id: number }>(sql`select id from payment_plan where id = ${r.plan_id}`);
    if (p) await cancelPlan(String(p.id), who);
  }
  await db().execute(sql`update claim set review_outcome = 'retake', status = 'retake', reviewed_by = ${who}, reviewed_at = now(), updated_at = now() where id = ${claimId}::uuid`);
  const channel = r.payee_type === "email" ? "email" : r.payee_type ? "sms" : "email";
  await db().execute(sql`
    insert into notice (firm_id, recall_number, claim_id, kind, channel, status, provider)
    values (${firm.id}, ${r.recall_number}, ${claimId}::uuid, 're_notice', ${channel}, 'queued', 'stub')`);
  await audit("person", "claim.retake_asked", `claim:${claimId}`, { by: who, channel, sent: false, reason: "no mail service connected; message logged" });
  console.log(`[firm] would send a retake message by ${channel} to ${r.payee_masked ?? "the owner"} for claim ${claimId}`);
  return { ok: true as const, message, channel, to: r.payee_masked ?? "the owner", sent: false };
}

/** The stored photo of a claim, for the thumbnail and the drawer. */
export async function claimPhoto(firmId: number, claimId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(claimId)) return null;
  const [p] = await run<{ bytes: Buffer | null; mime: string }>(sql`
    select ph.bytes, ph.mime from claim c join photo ph on ph.id = c.photo_id where c.id = ${claimId}::uuid and c.firm_id = ${firmId}`);
  return p?.bytes ? p : null;
}
