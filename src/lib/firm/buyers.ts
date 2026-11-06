/**
 * Buyers of a recalled product, from the firm's own sales file: the CSV template, parsing, and matching each line to
 * the recalled product. Matching is deterministic (the payments engine's matchItem: shared words, or an exact SKU),
 * so the same file always gives the same buyers. Contacts are masked here; they are stored only encrypted.
 */
import Papa from "papaparse";
import { matchItem } from "@/lib/payments/buyers";
import { refundWindow } from "@/lib/payments/refunds";
import { maskContact } from "@/lib/secure";

export const CSV_COLUMNS = ["order_id", "order_date", "buyer_email", "buyer_phone", "item_name", "sku", "quantity", "amount_usd", "paid_with", "paypal_transaction_id"] as const;

/** The downloadable template: the header and two sample lines (example.com addresses, sample products). */
export function csvTemplate(product: { name: string; sku?: string | null }) {
  return [
    CSV_COLUMNS.join(","),
    `BLH-1001,2026-09-14,jordan@example.com,,${csvSafe(product.name)},${product.sku ?? ""},1,34.99,paypal,`,
    `BLH-1002,2026-10-02,,(415) 555-0134,Desk lamp (sample),BLH-LAMP,1,19.00,card,`,
  ].join("\n") + "\n";
}
const csvSafe = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export type Target = { name: string; sku?: string | null };

export type BuyerLine = {
  line: number;
  orderId: string;
  orderDate: string | null;
  contact: string;
  contactType: "email" | "phone" | null;
  item: string;
  sku: string | null;
  quantity: number;
  amountCents: number;
  paidWith: string;
  transactionId: string | null;
  score: number;
  matched: boolean;
  /** Paid with PayPal inside the 180-day refund window: the refund goes back to that payment after the photo. */
  refundToOriginal: boolean;
  refundableUntil: string | null;
  issue: string | null;
};

export type ParsedLine = BuyerLine & { email: string | null; phone: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a sales CSV and score every line against the recalled product. At most 5,000 lines. */
export function parseSales(text: string, targets: Target[], now: Date, minScore = 0.6): { lines: ParsedLine[]; errors: string[]; total: number } {
  const errors: string[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
  const fields = parsed.meta.fields ?? [];
  if (!fields.includes("item_name")) errors.push("The file needs an item_name column. Download the template to see every column.");
  if (!fields.includes("buyer_email") && !fields.includes("buyer_phone")) errors.push("The file needs a buyer_email or buyer_phone column.");
  if (errors.length) return { lines: [], errors, total: 0 };
  const rows = parsed.data.slice(0, 5000);
  const lines = rows.map((r, i): ParsedLine => {
    const email = (r.buyer_email ?? "").trim().toLowerCase() || null;
    const phoneDigits = (r.buyer_phone ?? "").replace(/\D/g, "");
    const phone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;
    const item = (r.item_name ?? "").trim();
    const sku = (r.sku ?? "").trim() || null;
    const score = Math.max(0, ...targets.map((t) => matchItem({ name: item, sku }, t)));
    const date = (r.order_date ?? "").trim();
    const orderDate = /^\d{4}-\d{2}-\d{2}/.test(date) && !Number.isNaN(Date.parse(date)) ? date.slice(0, 10) : null;
    const paidWith = (r.paid_with ?? "").trim().toLowerCase();
    const transactionId = (r.paypal_transaction_id ?? "").trim() || null;
    const win = paidWith === "paypal" && orderDate ? refundWindow(`${orderDate}T12:00:00Z`, now) : null;
    const amount = Number(String(r.amount_usd ?? "").replace(/[$,\s]/g, ""));
    let issue: string | null = null;
    const validEmail = email && EMAIL.test(email) ? email : null;
    if (!validEmail && !phone) issue = "No email or phone to send the notice to.";
    else if (!orderDate) issue = "No order date, so the 180-day PayPal refund window cannot be checked.";
    const contactValue = validEmail ?? phone;
    return {
      line: i + 2,
      orderId: (r.order_id ?? "").trim().slice(0, 64),
      orderDate,
      contact: contactValue ? maskContact(contactValue) : "None",
      contactType: validEmail ? "email" : phone ? "phone" : null,
      email: validEmail,
      phone,
      item: item.slice(0, 200),
      sku,
      quantity: Math.max(1, Math.min(99, Math.round(Number(r.quantity) || 1))),
      amountCents: Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0,
      paidWith: paidWith || "unknown",
      transactionId,
      score: Math.round(score * 100) / 100,
      matched: score >= minScore,
      refundToOriginal: Boolean(win?.within && paidWith === "paypal"),
      refundableUntil: win?.deadline ?? null,
      issue,
    };
  });
  if (parsed.errors.length) errors.push(...parsed.errors.slice(0, 3).map((e) => `Line ${(e.row ?? 0) + 2}: ${e.message}`));
  return { lines, errors, total: parsed.data.length };
}

/** The line as the browser sees it: no raw email or phone. */
export const publicLine = ({ email: _e, phone: _p, ...rest }: ParsedLine): BuyerLine => {
  void _e;
  void _p;
  return rest;
};

/** The notice a matched buyer would get, with their personal claim link. */
export function noticeText(o: { firmName: string; product: string; recallNumber: string; link: string; refundToOriginal: boolean }) {
  return [
    `Your ${o.product} is part of a safety recall (CPSC recall ${o.recallNumber}). Please stop using it.`,
    `Make it safe the way the recall describes, take one photo, and send it with your personal link: ${o.link}`,
    o.refundToOriginal ? "You paid with PayPal, so your refund goes back to that same payment once your photo checks out." : "Your refund is sent to your PayPal or Venmo once your photo checks out.",
    `Thank you for keeping your home safe. The ${o.firmName} recall team.`,
  ].join(" ");
}
