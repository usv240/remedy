import { resolveDeps, toCents, type PaymentsDeps } from "./deps";
import { refundWindow } from "./refunds";
import { hashBuyerEmail } from "./shop";
import type { Sale } from "./types";

/**
 * Find the people who bought a recalled product from the firm with PayPal, from PayPal Transaction Search
 * (GET /v1/reporting/transactions, fields=all). The API answers at most 31 days per request, so a longer range is
 * cut into 31-day slices. Each sale's cart lines (`cart_info.item_details`) are matched to the product name.
 * The sandbox can take up to three hours to list a new transaction, so a purchase made a minute ago may not be here yet.
 */

const DAY = 86_400_000;
export const MAX_WINDOW_DAYS = 31;

/** Cut [start, end] into slices of at most 31 days, oldest first. */
export function sliceWindows(start: Date, end: Date, days = MAX_WINDOW_DAYS): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  let s = start.getTime();
  const e = end.getTime();
  while (s < e) {
    const next = Math.min(s + days * DAY, e);
    out.push({ start: new Date(s), end: new Date(next) });
    s = next;
  }
  return out;
}

const STOP = new Set(["the", "a", "an", "and", "for", "of", "with", "sample", "by", "in", "new"]);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(sample\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t));

/**
 * How well a cart line names the product, 0 to 1: the share of the product's words found in the line, or 1 for an
 * exact SKU. Deterministic; the firm console can add Elastic fuzzy search and Claude for messy names on top.
 */
export function matchItem(item: { name?: string | null; sku?: string | null }, product: { name: string; sku?: string | null }) {
  if (product.sku && item.sku && item.sku.trim().toLowerCase() === product.sku.trim().toLowerCase()) return 1;
  const want = [...new Set(tokens(product.name))];
  if (!want.length || !item.name) return 0;
  const have = new Set(tokens(item.name));
  return want.filter((t) => have.has(t)).length / want.length;
}

type Money = { value?: string; currency_code?: string };
type Detail = {
  transaction_info?: { transaction_id?: string; transaction_event_code?: string; transaction_initiation_date?: string; transaction_amount?: Money; transaction_status?: string };
  payer_info?: { email_address?: string; payer_name?: { given_name?: string; surname?: string; alternate_full_name?: string } };
  cart_info?: { item_details?: { item_code?: string; item_name?: string; item_quantity?: string; item_amount?: Money; total_item_amount?: Money }[] };
};
type SearchBody = { transaction_details?: Detail[]; total_pages?: number; total_items?: number; name?: string; message?: string };

export type Buyer = {
  buyerEmail: string | null;
  buyerName: string | null;
  item: string;
  sku: string | null;
  quantity: number;
  amountCents: number;
  currency: string;
  paidAt: string;
  /** The transaction id, which for Orders v2 payments is the capture id a refund goes back to. */
  captureId: string;
  eventCode: string;
  matchScore: number;
  /** Inside PayPal's 180-day refund window today. */
  refundable: boolean;
  refundableUntil: string;
};

export type WindowReport = { start: string; end: string; status: number; transactions: number; pages: number; issue: string | null };

const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Buyers of `product` between `start` and `end`. Incoming payments only (positive T00xx transactions). */
export async function findBuyers(o: { start: Date; end: Date; product: { name: string; sku?: string | null }; minScore?: number }, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  const now = deps.now();
  const end = new Date(Math.min(o.end.getTime(), now.getTime()));
  const minScore = o.minScore ?? 0.6;
  const buyers = new Map<string, Buyer>();
  const windows: WindowReport[] = [];
  let scanned = 0;

  for (const w of sliceWindows(o.start, end)) {
    const rep: WindowReport = { start: w.start.toISOString(), end: w.end.toISOString(), status: 200, transactions: 0, pages: 0, issue: null };
    for (let page = 1; page <= 20; page++) {
      const q = new URLSearchParams({ start_date: stamp(w.start), end_date: stamp(w.end), fields: "all", page_size: "500", page: String(page) });
      const r = await deps.rest<SearchBody>(`/v1/reporting/transactions?${q}`, { method: "GET" });
      rep.pages = page;
      if (r.status >= 400) {
        rep.status = r.status;
        rep.issue = r.body.name ?? "PAYPAL_ERROR";
        break;
      }
      for (const d of r.body.transaction_details ?? []) {
        scanned++;
        rep.transactions++;
        const t = d.transaction_info;
        const amount = toCents(t?.transaction_amount?.value ?? 0);
        if (!t?.transaction_id || amount <= 0 || !(t.transaction_event_code ?? "").startsWith("T00")) continue;
        for (const line of d.cart_info?.item_details ?? []) {
          const score = matchItem({ name: line.item_name, sku: line.item_code }, o.product);
          if (score < minScore) continue;
          const prev = buyers.get(t.transaction_id);
          if (prev && prev.matchScore >= score) continue;
          const paidAt = t.transaction_initiation_date ?? w.end.toISOString();
          const win = refundWindow(paidAt, now);
          const n = d.payer_info?.payer_name;
          buyers.set(t.transaction_id, {
            buyerEmail: d.payer_info?.email_address ?? null,
            buyerName: n?.alternate_full_name ?? ([n?.given_name, n?.surname].filter(Boolean).join(" ") || null),
            item: line.item_name ?? "",
            sku: line.item_code ?? null,
            quantity: Number(line.item_quantity ?? 1) || 1,
            amountCents: amount,
            currency: t.transaction_amount?.currency_code ?? "USD",
            paidAt: new Date(paidAt).toISOString(),
            captureId: t.transaction_id,
            eventCode: t.transaction_event_code ?? "",
            matchScore: Math.round(score * 100) / 100,
            refundable: win.within,
            refundableUntil: win.deadline,
          });
        }
      }
      if ((r.body.total_pages ?? 1) <= page) break;
    }
    windows.push(rep);
  }
  return {
    buyers: [...buyers.values()].sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
    windows,
    scanned,
    note: "PayPal's sandbox can take up to three hours to list a new purchase in Transaction Search.",
  };
}

/** Save matched buyers as sales (email kept only as a hash), so their claims can be refunded to the capture. */
export async function importBuyersAsSales(buyers: Buyer[], partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  let created = 0;
  for (const b of buyers) {
    const sale: Sale = {
      id: `sale_${b.captureId}`,
      firmId: deps.firm.id,
      source: "paypal",
      buyerEmailHash: b.buyerEmail ? hashBuyerEmail(b.buyerEmail) : null,
      itemName: b.item,
      sku: b.sku,
      amountCents: b.amountCents,
      paidAt: b.paidAt,
      paypalCaptureId: b.captureId,
      paypalOrderId: null,
    };
    if ((await deps.store.insertSale(sale)).created) created++;
  }
  if (created) await deps.ledger("system", "buyers.imported", "firm:sample", { source: "paypal_transaction_search", created });
  return { created, total: buyers.length };
}
