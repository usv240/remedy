/**
 * Saving matched buyers as sales and making each a personal claim link and a notice. Server only.
 * Contacts are stored encrypted (sale.buyer_contact_enc) with the payments engine's email hash, so an owner who later
 * claims with the same email is linked to the sale, and a PayPal buyer inside 180 days is refunded to that payment.
 * A claim link's token is shown once and stored only as its SHA-256. Remedy sends no mail: each notice is returned
 * once, with its link, subject and text, and the firm downloads them as a CSV for its own mail tool
 * (src/lib/firm/notices.ts). The notice row stays queued with provider "export" until a claim arrives through its link.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { hashBuyerEmail } from "@/lib/payments/shop";
import { refundWindow } from "@/lib/payments/refunds";
import { decrypt, encrypt, hashContact, maskContact } from "@/lib/secure";
import { SHOP } from "@/lib/payments/shop-catalog";
import type { ParsedLine, Target } from "./buyers";
import { noticeEmail } from "./notices";
import { SAMPLE_RECALL, type Firm, type FirmRecall } from "./firm";
import { SAMPLE_TS_MARK } from "./samples/transaction-search";
import { notTest } from "./origin";

/** The names a sales line can match: the recall's products, and for the sample recall the sample shop's product. */
export function targetsFor(recall: FirmRecall): Target[] {
  const t: Target[] = recall.products.filter((p) => p.name).map((p) => ({ name: p.name, sku: p.model || null }));
  if (!t.length) t.push({ name: recall.short });
  if (recall.number === SAMPLE_RECALL) t.push({ name: SHOP.product.name, sku: SHOP.product.sku });
  return t;
}

export type SavedSale = { saleId: number; line: number; contact: string; item: string; refundToOriginal: boolean; created: boolean };

/** Save the matched lines as sales (source csv). A line already saved (same buyer, item, day and amount) is reused. */
export async function saveMatchedSales(firm: Firm, recall: FirmRecall, lines: ParsedLine[]): Promise<SavedSale[]> {
  const out: SavedSale[] = [];
  for (const l of lines.filter((x) => x.matched && !x.issue).slice(0, 500)) {
    const contact = l.email ?? l.phone!;
    const emailHash = l.email ? hashBuyerEmail(l.email) : null;
    const paidAt = new Date(`${l.orderDate}T12:00:00Z`);
    const capture = l.paidWith === "paypal" && l.transactionId ? l.transactionId : null;
    const [have] = (
      await db().execute(sql`
      select id from sale where firm_id = ${firm.id} and recall_number = ${recall.number} and source = 'csv'
        and coalesce(buyer_email_hash, '') = coalesce(${emailHash}, '') and item_name = ${l.item} and paid_at = ${paidAt} and amount = ${(l.amountCents / 100).toFixed(2)}
        and (sku is not distinct from ${l.sku})
      limit 1`)
    ).rows as { id: number }[];
    if (have) {
      out.push({ saleId: have.id, line: l.line, contact: l.contact, item: l.item, refundToOriginal: l.refundToOriginal, created: false });
      continue;
    }
    const [row] = (
      await db().execute(sql`
      insert into sale (firm_id, recall_number, source, buyer_email_hash, buyer_contact_enc, item_name, sku, quantity, amount, paid_at, paypal_capture_id)
      values (${firm.id}, ${recall.number}, 'csv', ${emailHash}, ${encrypt(contact)}, ${l.item}, ${l.sku}, ${l.quantity}, ${(l.amountCents / 100).toFixed(2)}, ${paidAt}, ${capture})
      on conflict do nothing
      returning id`)
    ).rows as { id: number }[];
    if (row) out.push({ saleId: row.id, line: l.line, contact: l.contact, item: l.item, refundToOriginal: l.refundToOriginal, created: true });
    else if (capture) {
      const [dup] = (await db().execute(sql`select id from sale where paypal_capture_id = ${capture}`)).rows as { id: number }[];
      if (dup) out.push({ saleId: dup.id, line: l.line, contact: l.contact, item: l.item, refundToOriginal: l.refundToOriginal, created: false });
    }
  }
  const created = out.filter((s) => s.created).length;
  if (created) await audit("person", "buyers.imported", `firm:${firm.id}`, { source: "csv", recall: recall.number, created, matched: out.length });
  return out;
}

export type NoticeLink = {
  saleId: number;
  /** Masked; the full address stays encrypted on the server, and the firm's own file supplies it to its download. */
  contact: string;
  channel: "email" | "sms";
  link: string;
  subject: string;
  message: string;
  paragraphs: string[];
  status: "ready" | "already_notified";
  refundToOriginal: boolean;
};

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

/** "Notify matched buyers": one notice per sale, each with a personal claim link. Returns the links to show once. */
export async function notifySales(firm: Firm, recall: FirmRecall, saleIds: number[], origin: string): Promise<NoticeLink[]> {
  const ids = [...new Set(saleIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (!ids.length) return [];
  const sales = (
    await db().execute(sql`
    select s.id, s.buyer_contact_enc, s.paid_at, s.paypal_capture_id, s.source,
           exists (select 1 from notice n where n.sale_id = s.id and n.kind = 'notice') as notified
    from sale s where s.firm_id = ${firm.id} and s.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
  ).rows as { id: number; buyer_contact_enc: string | null; paid_at: Date | null; paypal_capture_id: string | null; source: string; notified: boolean }[];

  const out: NoticeLink[] = [];
  for (const s of sales) {
    let contact: string | null = null;
    try {
      contact = s.buyer_contact_enc ? decrypt(s.buyer_contact_enc) : null;
    } catch {
      contact = null;
    }
    if (!contact) continue;
    const channel = contact.includes("@") ? "email" : "sms";
    const refundToOriginal = Boolean(s.paypal_capture_id && s.paid_at && refundWindow(s.paid_at, new Date()).within);
    if (s.notified) {
      out.push({ saleId: s.id, contact: maskContact(contact), channel, link: "", subject: "", message: "", paragraphs: [], status: "already_notified", refundToOriginal });
      continue;
    }
    const token = randomBytes(18).toString("base64url");
    const link = `${origin.replace(/\/$/, "")}/claim/${encodeURIComponent(recall.number)}?n=${token}`;
    await db().execute(sql`
      insert into notice (firm_id, recall_number, sale_id, kind, channel, recipient_hash, claim_link_token_hash, status, provider)
      values (${firm.id}, ${recall.number}, ${s.id}, 'notice', ${channel}, ${hashContact(contact)}, ${tokenHash(token)}, 'queued', 'export')`);
    const email = noticeEmail({ firmName: firm.name.replace(/\s*\(sample\)\s*$/i, ""), product: recall.short, recallNumber: recall.number, link, refundToOriginal });
    out.push({ saleId: s.id, contact: maskContact(contact), channel, link, subject: email.subject, message: email.paragraphs.join(" "), paragraphs: email.paragraphs, status: "ready", refundToOriginal });
  }
  const ready = out.filter((o) => o.status === "ready").length;
  if (ready) await audit("person", "notices.made", `firm:${firm.id}`, { recall: recall.number, ready, provider: "export" });
  return out;
}

/** Sales already in Remedy for this recall: the sample shop, PayPal Transaction Search and earlier files. */
export async function knownSales(firm: Firm, recall: FirmRecall) {
  const rows = (
    await db().execute(sql`
    select s.id, s.source, s.item_name, s.amount::text as amount, s.paid_at, s.paypal_capture_id, s.paypal_order_id, s.buyer_contact_enc,
           (select count(*)::int from notice n where n.sale_id = s.id) as notices,
           (select count(*)::int from claim c where c.linked_sale_id = s.id and ${notTest()}) as claims
    from sale s where s.firm_id = ${firm.id} and (s.recall_number = ${recall.number} or s.recall_number is null)
    order by s.paid_at desc nulls last limit 200`)
  ).rows as { id: number; source: string; item_name: string; amount: string; paid_at: Date | null; paypal_capture_id: string | null; paypal_order_id: string | null; buyer_contact_enc: string | null; notices: number; claims: number }[];
  const now = new Date();
  return rows.map((r) => {
    let contact = "Kept as a hash only";
    if (r.buyer_contact_enc) {
      try {
        contact = maskContact(decrypt(r.buyer_contact_enc));
      } catch {
        /* key changed */
      }
    }
    const win = r.paypal_capture_id && r.paid_at ? refundWindow(r.paid_at, now) : null;
    return {
      saleId: r.id,
      source: r.source as "csv" | "paypal" | "shop",
      item: r.item_name,
      amountCents: Math.round(Number(r.amount) * 100),
      paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      contact,
      refundToOriginal: Boolean(win?.within),
      notified: r.notices > 0,
      claimed: r.claims > 0,
      /** A row of the labelled sample Transaction Search answer (src/lib/firm/samples/transaction-search.ts). */
      sample: r.paypal_order_id === SAMPLE_TS_MARK,
    };
  });
}
