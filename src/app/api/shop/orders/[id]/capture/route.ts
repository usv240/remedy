import { fail, ok } from "@/lib/api/envelope";
import { dbConfigured } from "@/lib/db";
import { paypalConfigured } from "@/lib/paypal/client";
import { toValue } from "@/lib/payments/deps";
import { captureShopOrder } from "@/lib/payments/shop";
import { SHOP, type ShopOrderCaptured } from "@/lib/payments/shop-catalog";

/**
 * POST /api/shop/orders/{id}/capture: capture an approved sample-shop order and record the sale (buyer email kept
 * only as a hash, with the capture id a later refund goes back to). Safe to call twice; only shop orders are captured.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  const { id } = await ctx.params;
  if (!/^[A-Z0-9]{10,24}$/.test(id)) return fail("invalid_request", "That order id does not look right.", 400);
  if (!paypalConfigured() || !dbConfigured()) return fail("upstream_unavailable", "PayPal sandbox is not set up on this server.", 503);
  const r = await captureShopOrder(id);
  switch (r.kind) {
    case "not_found":
      return fail("not_found", "PayPal has no order with that id.", 404);
    case "not_shop":
      return fail("invalid_request", "That order is not from the Brightline Home sample shop.", 400);
    case "declined":
    case "failed":
      return fail(r.kind === "declined" ? "invalid_request" : "upstream_unavailable", r.plain, r.status >= 500 ? 502 : r.status, { issue: r.issue, debug_id: r.debugId });
    default: {
      const data: ShopOrderCaptured = {
        order_id: id,
        status: r.status,
        already: r.kind === "already",
        capture_id: r.sale.paypalCaptureId,
        amount: toValue(r.sale.amountCents),
        sale_id: r.sale.id,
        paid_at: r.sale.paidAt,
        payer_first_name: r.payerFirstName,
        refundable_until: r.refundableUntil,
      };
      return ok(data, started, { label: SHOP.label });
    }
  }
}
