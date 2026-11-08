import { createHash } from "node:crypto";
import { recallLabel, sampleFirmOf } from "@/lib/recall/label";
import { SANDBOX_LABEL, resolveDeps, toCents, toValue, type PaymentsDeps } from "./deps";
import { recordStatus, type PaymentEventSource } from "./events";
import { payoutItemStatus, plainIssue } from "./status";
import type { Payee, PaymentRecord } from "./types";

/**
 * PayPal Payouts: one batch pays one or many approved claims, straight from the firm's PayPal account to the owner's
 * email, phone or Venmo. `sender_item_id` is the claim id, so every item maps back to its claim. The batch id is
 * derived from the claims and their attempt numbers, and is also sent as PayPal-Request-Id, so a retry of the same
 * attempt can never pay twice. PayPal does not replay the first answer for a repeated Payouts request; it refuses the
 * repeat with "Batch with given sender_batch_id already exists" and a link to that batch, which this file reads as
 * the batch it already made (so a lost response is recovered, not resent). Sandbox findings (Nov 5, 2026): EMAIL and
 * PHONE items are accepted and reach SUCCESS;
 * `recipient_wallet: "VENMO"` is refused with "Recipient wallet not supported in sandbox", so in the sandbox a Venmo
 * item is resent once as a PayPal PHONE item and the payment says so.
 */

export type PayoutLine = {
  claimId: string;
  amountCents: number;
  payee: Payee;
  recallNumber: string;
  recallTitle: string;
};

type Recipient = { recipient_type: "EMAIL" | "PHONE"; receiver: string; recipient_wallet?: "VENMO" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(v: string) {
  const e = v.trim().toLowerCase();
  return EMAIL.test(e) && e.length <= 127 ? e : null;
}

/** A US phone number as 10 digits, or null. Accepts "(408) 555-0123", "+1 408 555 0123" and the like. */
export function normalizeUsPhone(v: string) {
  const d = v.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(n) ? n : null;
}

/** The Payouts recipient fields for a payee, or a plain reason it cannot be paid. */
export function recipientFor(payee: Payee, opts: { venmoWallet: boolean } = { venmoWallet: true }): Recipient | { error: string } {
  if (payee.type === "email") {
    const e = normalizeEmail(payee.value);
    return e ? { recipient_type: "EMAIL", receiver: e } : { error: "That email address does not look complete." };
  }
  const phone = normalizeUsPhone(payee.value);
  if (!phone) return { error: "Please use a 10-digit US phone number." };
  if (payee.type === "venmo" && opts.venmoWallet) return { recipient_type: "PHONE", receiver: phone, recipient_wallet: "VENMO" };
  return { recipient_type: "PHONE", receiver: phone };
}

/** The firm named on a payout: only on its own fictional sample recall, never as the payer of a real CPSC recall. */
const payerOn = (recallNumber: string, firmName: string) => (sampleFirmOf(recallNumber) ? ` from ${firmName.replace(/\s*\(sample\)\s*$/i, "")}` : "");

export function payoutNote(line: Pick<PayoutLine, "recallNumber" | "recallTitle">, firmName: string) {
  return `Recall refund for ${line.recallTitle} (${recallLabel(line.recallNumber)})${payerOn(line.recallNumber, firmName)}. Thank you for making it safe. ${SANDBOX_LABEL}`.slice(0, 4000);
}

/** sender_item_id is the claim id (PayPal allows 63 characters). */
export const senderItemIdFor = (claimId: string) => claimId.slice(0, 63);

/** One claim: `rmd-<claim>-a<attempt>`. Several: a hash of every claim and attempt, so the same set gives the same id. */
export function senderBatchIdFor(parts: { claimId: string; attempt: number }[]) {
  if (parts.length === 1) return `rmd-${parts[0].claimId}-a${parts[0].attempt}`.slice(0, 120);
  const key = parts
    .map((p) => `${p.claimId}:${p.attempt}`)
    .sort()
    .join("|");
  return `rmd-bulk-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function buildPayoutBatch(lines: PayoutLine[], o: { senderBatchId: string; firmName: string; venmoWallet: boolean }) {
  const items = lines.map((l) => {
    const r = recipientFor(l.payee, { venmoWallet: o.venmoWallet });
    if ("error" in r) throw new Error(`Claim ${l.claimId}: ${r.error}`);
    return { ...r, amount: { value: toValue(l.amountCents), currency: "USD" }, note: payoutNote(l, o.firmName), sender_item_id: senderItemIdFor(l.claimId) };
  });
  return {
    sender_batch_header: {
      sender_batch_id: o.senderBatchId,
      email_subject: `Your recall refund${lines.length && lines.every((l) => sampleFirmOf(l.recallNumber)) ? payerOn(lines[0].recallNumber, o.firmName) : ""}`,
      email_message: `Thank you for making your recalled product safe. ${SANDBOX_LABEL}`,
    },
    items,
  };
}

type PayPalError = { name?: string; message?: string; details?: { field?: string; issue?: string; description?: string; link?: { href?: string; rel?: string }[] }[]; debug_id?: string };
type BatchHeader = { payout_batch_id?: string; batch_status?: string; sender_batch_header?: { sender_batch_id?: string }; amount?: { value?: string }; fees?: { value?: string }; time_created?: string; time_completed?: string };
export type PayPalPayoutItem = {
  payout_item_id?: string;
  sender_batch_id?: string;
  transaction_id?: string;
  transaction_status?: string;
  payout_batch_id?: string;
  payout_item_fee?: { value?: string };
  payout_item?: { sender_item_id?: string; recipient_type?: string; recipient_wallet?: string; amount?: { value?: string } };
  errors?: { name?: string; message?: string };
  time_processed?: string;
};
type BatchBody = PayPalError & { batch_header?: BatchHeader; items?: PayPalPayoutItem[]; total_page?: number; total_items?: number };

export type CreateBatchResult =
  /** `existing`: PayPal already had this sender_batch_id (an earlier send whose answer was lost); this is that batch. */
  | { ok: true; payoutBatchId: string; batchStatus: string; senderBatchId: string; walletFallback: boolean; existing: boolean; debugId: string | null }
  /** `definite`: PayPal refused, nothing was sent, a new attempt is safe. Otherwise retry with the same id. */
  | { ok: false; issue: string; plain: string; status: number; debugId: string | null; definite: boolean };

export const issueOf = (b: PayPalError) => b.name ?? b.details?.[0]?.issue ?? "PAYPAL_ERROR";

/** The batch PayPal already made for this sender_batch_id, from its duplicate refusal. */
export function existingBatchId(status: number, b: PayPalError) {
  if (status !== 400) return null;
  const d = (b.details ?? []).find((x) => x.field === "SENDER_BATCH_ID" && /already exists/i.test(x.issue ?? ""));
  const href = d?.link?.find((l) => l.rel === "self")?.href ?? d?.link?.[0]?.href;
  const id = href?.split("?")[0].split("/").pop();
  return id && /^[A-Z0-9]{8,30}$/.test(id) ? id : null;
}

/** Send one Payouts batch. Retries a 5xx with the same request id; resends Venmo items as PHONE if the sandbox refuses the wallet. */
export async function createPayoutBatch(lines: PayoutLine[], o: { senderBatchId: string; mock?: string }, partial?: Partial<PaymentsDeps>): Promise<CreateBatchResult> {
  const deps = await resolveDeps(partial);
  const send = async (senderBatchId: string, venmoWallet: boolean) => {
    let body: ReturnType<typeof buildPayoutBatch>;
    try {
      body = buildPayoutBatch(lines, { senderBatchId, firmName: deps.firm.name, venmoWallet });
    } catch (e) {
      return { status: 400, body: { name: "VALIDATION_ERROR", message: (e as Error).message } as BatchBody, debugId: null };
    }
    const call = () =>
      deps.rest<BatchBody>("/v1/payments/payouts", {
        method: "POST",
        requestId: senderBatchId,
        body: JSON.stringify(body),
        headers: o.mock ? { "PayPal-Mock-Response": JSON.stringify({ mock_application_codes: o.mock }) } : {},
      });
    let r = await call().catch(() => ({ status: 599, body: { name: "NETWORK_ERROR" } as BatchBody, debugId: null }));
    for (let i = 1; r.status >= 500 && i <= 2; i++) {
      await new Promise((res) => setTimeout(res, 600 * i));
      r = await call().catch(() => ({ status: 599, body: { name: "NETWORK_ERROR" } as BatchBody, debugId: null }));
    }
    return r;
  };

  let senderBatchId = o.senderBatchId;
  let walletFallback = false;
  let r = await send(senderBatchId, true);
  const walletRefused = r.status === 400 && (r.body.details ?? []).some((d) => d.field?.includes("recipient_wallet"));
  if (walletRefused && lines.some((l) => l.payee.type === "venmo")) {
    walletFallback = true;
    senderBatchId = `${o.senderBatchId}-pp`;
    r = await send(senderBatchId, false);
  }
  const id = r.body.batch_header?.payout_batch_id;
  if (r.status < 400 && id) return { ok: true, payoutBatchId: id, batchStatus: r.body.batch_header?.batch_status ?? "PENDING", senderBatchId, walletFallback, existing: false, debugId: r.debugId };
  const existing = existingBatchId(r.status, r.body);
  if (existing) return { ok: true, payoutBatchId: existing, batchStatus: "PENDING", senderBatchId, walletFallback, existing: true, debugId: r.debugId };
  const issue = issueOf(r.body);
  return { ok: false, issue, plain: plainIssue(issue), status: r.status, debugId: r.debugId ?? r.body.debug_id ?? null, definite: r.status >= 400 && r.status < 500 };
}

export type PayoutBatchView = {
  payoutBatchId: string;
  senderBatchId: string | null;
  batchStatus: string;
  amountCents: number;
  feesCents: number;
  items: { payoutItemId: string | null; senderItemId: string | null; transactionId: string | null; paypalStatus: string; status: ReturnType<typeof payoutItemStatus>; issue: string | null; amountCents: number; recipientType: string | null; wallet: string | null }[];
};

/** Read a batch and all its items (every page). */
export async function getPayoutBatch(batchId: string, partial?: Partial<PaymentsDeps>): Promise<{ ok: true; batch: PayoutBatchView } | { ok: false; status: number; issue: string }> {
  const deps = await resolveDeps(partial);
  const items: PayoutBatchView["items"] = [];
  let header: BatchHeader | undefined;
  for (let page = 1; page <= 20; page++) {
    const r = await deps.rest<BatchBody>(`/v1/payments/payouts/${encodeURIComponent(batchId)}?page=${page}&page_size=1000&total_required=true`, { method: "GET" });
    if (r.status >= 400) return { ok: false, status: r.status, issue: issueOf(r.body) };
    header ??= r.body.batch_header;
    for (const it of r.body.items ?? []) items.push(viewItem(it));
    if ((r.body.total_page ?? 1) <= page) break;
  }
  return {
    ok: true,
    batch: {
      payoutBatchId: batchId,
      senderBatchId: header?.sender_batch_header?.sender_batch_id ?? null,
      batchStatus: header?.batch_status ?? "PENDING",
      amountCents: toCents(header?.amount?.value ?? 0),
      feesCents: toCents(header?.fees?.value ?? 0),
      items,
    },
  };
}

const viewItem = (it: PayPalPayoutItem): PayoutBatchView["items"][number] => ({
  payoutItemId: it.payout_item_id ?? null,
  senderItemId: it.payout_item?.sender_item_id ?? null,
  transactionId: it.transaction_id ?? null,
  paypalStatus: it.transaction_status ?? "PENDING",
  status: payoutItemStatus(it.transaction_status),
  issue: it.errors?.name ?? null,
  amountCents: toCents(it.payout_item?.amount?.value ?? 0),
  recipientType: it.payout_item?.recipient_type ?? null,
  wallet: it.payout_item?.recipient_wallet ?? null,
});

export async function getPayoutItem(itemId: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const r = await deps.rest<PayPalPayoutItem & PayPalError>(`/v1/payments/payouts-item/${encodeURIComponent(itemId)}`, { method: "GET" });
  if (r.status >= 400) return { ok: false as const, status: r.status, issue: issueOf(r.body) };
  return { ok: true as const, item: { ...viewItem(r.body), payoutBatchId: r.body.payout_batch_id ?? null } };
}

/**
 * Cancel a payout item that is still unclaimed; the money goes back to the firm. Only UNCLAIMED items can be
 * canceled (PayPal answers ITEM_INCORRECT_STATUS otherwise). The sandbox has answered 500 to this call, so a 5xx is
 * retried and then reported plainly; the item stays unclaimed and the poller keeps watching it.
 */
export async function cancelPayoutItem(itemId: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const call = () => deps.rest<PayPalPayoutItem & PayPalError>(`/v1/payments/payouts-item/${encodeURIComponent(itemId)}/cancel`, { method: "POST" });
  let r = await call();
  for (let i = 1; r.status >= 500 && i <= 2; i++) {
    await new Promise((res) => setTimeout(res, 800 * i));
    r = await call();
  }
  if (r.status >= 400) {
    const issue = issueOf(r.body);
    return { ok: false as const, status: r.status, issue, plain: r.status >= 500 ? "PayPal could not cancel this payment right now. It is still waiting to be accepted." : plainIssue(issue), debugId: r.debugId };
  }
  const [payment] = await deps.store.findPayments({ payoutItemId: itemId });
  const status = payoutItemStatus(r.body.transaction_status ?? "RETURNED");
  if (payment) await recordStatus(payment, status, { paypalStatus: r.body.transaction_status ?? null }, "cancel", deps);
  await deps.ledger("person", "paypal.payout_item.canceled", payment ? `claim:${payment.claimId}` : `payout_item:${itemId}`, { payout_item: itemId, paypal_status: r.body.transaction_status ?? null });
  return { ok: true as const, paypalStatus: r.body.transaction_status ?? "RETURNED", status };
}

/** Match one PayPal item to its payment row: by item id, else by batch and sender_item_id (the claim id). */
async function paymentForItem(batchId: string, it: { payoutItemId: string | null; senderItemId: string | null; senderBatchId?: string | null }, deps: PaymentsDeps): Promise<PaymentRecord | null> {
  if (it.payoutItemId) {
    const [byItem] = await deps.store.findPayments({ payoutItemId: it.payoutItemId });
    if (byItem) return byItem;
  }
  if (it.senderItemId && batchId) {
    const [byRef] = await deps.store.findPayments({ payoutBatchId: batchId, senderItemId: it.senderItemId });
    if (byRef) return byRef;
  }
  // Our own batch id is derived from the claims, so it finds the payment even before PayPal's batch id is stored.
  if (it.senderItemId && it.senderBatchId) {
    const [bySender] = await deps.store.findPayments({ senderBatchId: it.senderBatchId, senderItemId: it.senderItemId });
    if (bySender) return bySender;
  }
  return null;
}

/**
 * Ask PayPal for a batch and record each item's status. Safe to run from the webhook, the poller and a page view at
 * once: `recordStatus` changes and announces a status only when it actually moves.
 */
export async function syncPayoutBatch(batchId: string, source: PaymentEventSource, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const got = await getPayoutBatch(batchId, deps);
  if (!got.ok) return { ok: false as const, status: got.status, issue: got.issue };
  let changed = 0;
  let matched = 0;
  for (const it of got.batch.items) {
    const payment = await paymentForItem(batchId, it, deps);
    if (!payment) continue;
    matched++;
    const r = await recordStatus(payment, it.status, { paypalStatus: it.paypalStatus, issue: it.issue, payoutItemId: it.payoutItemId, transactionId: it.transactionId }, source, deps);
    if (r.changed) changed++;
  }
  return { ok: true as const, batchStatus: got.batch.batchStatus, items: got.batch.items.length, matched, changed };
}

/** Apply one payout item's status (from a verified webhook) without reading the whole batch. */
export async function applyPayoutItem(item: PayPalPayoutItem, source: PaymentEventSource, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const v = viewItem(item);
  const batchId = item.payout_batch_id ?? "";
  const payment = await paymentForItem(batchId, { ...v, senderBatchId: item.sender_batch_id ?? null }, deps);
  if (!payment) return { matched: false as const };
  const r = await recordStatus(payment, v.status, { paypalStatus: v.paypalStatus, issue: v.issue, payoutItemId: v.payoutItemId, transactionId: v.transactionId }, source, deps);
  return { matched: true as const, changed: r.changed, status: v.status };
}
