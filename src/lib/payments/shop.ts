import { createHash } from "node:crypto";
import { resolveDeps, toCents, toValue, type PaymentsDeps } from "./deps";
import { refundWindow } from "./refunds";
import { SHOP } from "./shop-catalog";
import { plainIssue } from "./status";
import type { Sale } from "./types";

export { SHOP, SHOP_ROUTES, type ShopOrderCaptured, type ShopOrderCreated } from "./shop-catalog";

/**
 * Brightline Home's sample shop: Orders v2 with server capture. The order has no payee, so the money goes to this
 * app's own sandbox business account, which stands in for the firm; that is also the account that refunds and pays
 * out, so a refund can go back to exactly this capture. Each capture is recorded once as a `sale`, with the buyer's
 * email kept only as a hash.
 */

/** Buyer emails are stored as a hash only: the same email always gives the same hash, so a claim can find its sale. */
export function hashBuyerEmail(email: string) {
  return createHash("sha256").update(`remedy:email:v1:${email.trim().toLowerCase()}`).digest("hex");
}

type Link = { rel?: string; href?: string };
type OrderBody = {
  id?: string;
  status?: string;
  name?: string;
  details?: { issue?: string }[];
  debug_id?: string;
  links?: Link[];
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  payment_source?: { paypal?: { email_address?: string; name?: { given_name?: string } } };
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    items?: { name?: string; sku?: string; quantity?: string }[];
    payments?: { captures?: { id?: string; status?: string; amount?: { value?: string }; create_time?: string }[] };
  }[];
};

export function shopOrderBody(o: { returnUrl?: string; cancelUrl?: string } = {}) {
  const value = toValue(SHOP.product.priceCents);
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: SHOP.referenceId,
        custom_id: `${SHOP.customIdPrefix}${SHOP.product.sku}`,
        description: SHOP.product.name,
        soft_descriptor: SHOP.softDescriptor,
        amount: { currency_code: "USD", value, breakdown: { item_total: { currency_code: "USD", value } } },
        items: [{ name: SHOP.product.name, sku: SHOP.product.sku, description: SHOP.product.description, quantity: "1", unit_amount: { currency_code: "USD", value }, category: "PHYSICAL_GOODS" }],
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: SHOP.firmName,
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          ...(o.returnUrl ? { return_url: o.returnUrl, cancel_url: o.cancelUrl ?? o.returnUrl } : {}),
        },
      },
    },
  };
}

const isShopOrder = (o: OrderBody) => {
  const pu = o.purchase_units?.[0];
  return pu?.reference_id === SHOP.referenceId || Boolean(pu?.custom_id?.startsWith(SHOP.customIdPrefix));
};

/** Create a sample-shop order for one power bank ($34.99). `returnUrl` is for redirect checkout (no JS button). */
export async function createShopOrder(o: { returnUrl?: string; cancelUrl?: string; requestId?: string } = {}, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  // ordersController.createOrder, on the SDK, with one PayPal-Request-Id per order.
  const r = await deps.paypal.createOrder<OrderBody>(shopOrderBody(o), { requestId: o.requestId ?? `shop-${crypto.randomUUID()}` });
  if (r.status >= 400 || !r.body.id) {
    const issue = r.body.details?.[0]?.issue ?? r.body.name ?? "PAYPAL_ERROR";
    return { ok: false as const, issue, plain: plainIssue(issue), status: r.status >= 400 ? r.status : 502, debugId: r.debugId };
  }
  const approveUrl = r.body.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
  await deps.ledger("person", "shop.order.created", `order:${r.body.id}`, { sku: SHOP.product.sku, amount: toValue(SHOP.product.priceCents) });
  return { ok: true as const, id: r.body.id, status: r.body.status ?? "CREATED", approveUrl, amountCents: SHOP.product.priceCents };
}

export type ShopCapture =
  | { kind: "captured" | "already"; sale: Sale; status: string; payerFirstName: string | null; refundableUntil: string }
  | { kind: "not_shop" | "not_found" }
  | { kind: "declined" | "failed"; issue: string; plain: string; status: number; debugId: string | null };

/**
 * Capture an approved shop order and record its sale. Safe to call twice and safe to race with the
 * CHECKOUT.ORDER.APPROVED webhook: the capture uses one PayPal-Request-Id per order, and the sale is unique per capture.
 * The order is read first, so this route can never capture an order that is not the shop's.
 */
export async function captureShopOrder(orderId: string, actor: "person" | "webhook" = "person", partial?: Partial<PaymentsDeps>): Promise<ShopCapture> {
  const deps = await resolveDeps(partial);
  const known = await deps.store.getSaleByOrder(orderId);
  if (known) return { kind: "already", sale: known, status: "COMPLETED", payerFirstName: null, refundableUntil: refundWindow(known.paidAt, deps.now()).deadline };

  const got = await deps.paypal.getOrder<OrderBody>(orderId);
  if (got.status === 404) return { kind: "not_found" };
  if (got.status >= 400) return { kind: "failed", issue: got.body.name ?? "PAYPAL_ERROR", plain: plainIssue(got.body.name), status: got.status, debugId: got.debugId };
  if (!isShopOrder(got.body)) return { kind: "not_shop" };

  let order = got.body;
  if (order.status !== "COMPLETED") {
    // ordersController.captureOrder, on the SDK; one PayPal-Request-Id per order, so a race with the webhook captures once.
    const capture = () => deps.paypal.captureOrder<OrderBody>(orderId, { requestId: `shop-capture-${orderId}` });
    let r = await capture();
    for (let i = 1; r.status >= 500 && i <= 3; i++) {
      await new Promise((res) => setTimeout(res, 700 * i));
      r = await capture();
    }
    const issue = r.body.details?.[0]?.issue ?? r.body.name ?? null;
    if (issue === "ORDER_ALREADY_CAPTURED" || (r.status < 400 && !r.body.purchase_units?.[0]?.payments?.captures?.length)) {
      const again = await deps.paypal.getOrder<OrderBody>(orderId);
      if (again.status < 400) order = again.body;
    } else if (r.status >= 400 || r.body.status !== "COMPLETED") {
      const code = issue ?? r.body.status ?? "PAYPAL_ERROR";
      await deps.ledger(actor, code === "INSTRUMENT_DECLINED" ? "shop.payment.declined" : "shop.capture.failed", `order:${orderId}`, { issue: code });
      return { kind: code === "INSTRUMENT_DECLINED" ? "declined" : "failed", issue: code, plain: plainIssue(code), status: r.status >= 400 ? r.status : 502, debugId: r.debugId ?? r.body.debug_id ?? null };
    } else {
      order = r.body;
    }
  }

  const pu = order.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  if (!cap?.id) return { kind: "failed", issue: "NO_CAPTURE", plain: "PayPal has not completed this payment yet.", status: 409, debugId: null };
  const email = order.payment_source?.paypal?.email_address ?? order.payer?.email_address ?? null;
  const item = pu?.items?.[0];
  const sale: Sale = {
    id: `sale_${cap.id}`,
    firmId: deps.firm.id,
    source: "shop",
    buyerEmailHash: email ? hashBuyerEmail(email) : null,
    itemName: item?.name ?? SHOP.product.name,
    sku: item?.sku ?? SHOP.product.sku,
    amountCents: toCents(cap.amount?.value ?? 0),
    paidAt: cap.create_time ?? deps.now().toISOString(),
    paypalCaptureId: cap.id,
    paypalOrderId: orderId,
  };
  const { sale: saved, created } = await deps.store.insertSale(sale);
  if (created) await deps.ledger(actor, "shop.sale.recorded", `sale:${saved.id}`, { order: orderId, capture: cap.id, amount: toValue(saved.amountCents), sku: saved.sku, buyer_linked: Boolean(saved.buyerEmailHash) });
  const first = order.payment_source?.paypal?.name?.given_name ?? order.payer?.name?.given_name ?? null;
  return { kind: created ? "captured" : "already", sale: saved, status: cap.status ?? "COMPLETED", payerFirstName: first, refundableUntil: refundWindow(saved.paidAt, deps.now()).deadline };
}

/** The shop sales an owner made with this email (for linking a claim to its PayPal capture). */
export async function salesForBuyer(email: string, partial?: Partial<PaymentsDeps>) {
  const deps = await resolveDeps(partial);
  return deps.store.findSalesByBuyerHash(hashBuyerEmail(email));
}
