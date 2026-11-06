import { fail, ok } from "@/lib/api/envelope";
import { publicOrigin } from "@/lib/origin";
import { paypalConfigured } from "@/lib/paypal/client";
import { toValue } from "@/lib/payments/deps";
import { createShopOrder } from "@/lib/payments/shop";
import { SHOP, type ShopOrderCreated } from "@/lib/payments/shop-catalog";

/**
 * POST /api/shop/orders: start a sandbox purchase of Brightline Home's sample power bank ($34.99), for the PayPal
 * button (JS SDK v6 createOrder). Optional body `{ return_path, cancel_path }` (paths on this site, starting with "/")
 * makes a redirect checkout instead, for a page without the button.
 */
export async function POST(req: Request) {
  const started = Date.now();
  if (!paypalConfigured()) return fail("upstream_unavailable", "PayPal sandbox is not set up on this server.", 503);
  const body = (await req.json().catch(() => ({}))) as { return_path?: unknown; cancel_path?: unknown };
  const path = (v: unknown) => (typeof v === "string" && /^\/[A-Za-z0-9/_\-?=&.]{0,200}$/.test(v) && !v.startsWith("//") ? v : null);
  const ret = path(body.return_path);
  const cancel = path(body.cancel_path);
  if ((body.return_path !== undefined && !ret) || (body.cancel_path !== undefined && !cancel)) return fail("invalid_request", "Return and cancel paths must be paths on this site.", 400);
  const origin = publicOrigin(req);
  const r = await createShopOrder(ret ? { returnUrl: origin + ret, cancelUrl: origin + (cancel ?? ret) } : {});
  if (!r.ok) return fail("upstream_unavailable", r.plain, r.status >= 500 ? 502 : r.status, { issue: r.issue, debug_id: r.debugId });
  const data: ShopOrderCreated = { id: r.id, status: r.status, approve_url: r.approveUrl, amount: toValue(r.amountCents), product: { sku: SHOP.product.sku, name: SHOP.product.name } };
  return ok(data, started, { label: SHOP.label });
}
