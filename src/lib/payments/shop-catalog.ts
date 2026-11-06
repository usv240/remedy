/**
 * The sample shop's catalog, safe to import from client components (no server code here). Brightline Home is a
 * fictional sample firm; the power bank is a fictional sample product sold only in the PayPal sandbox, so a judge can
 * buy it, claim it, and see the refund go back to that same purchase.
 */
export const SHOP = {
  firmName: "Brightline Home (sample)",
  /** Marks shop orders at PayPal, so the capture route never captures any other order. */
  referenceId: "brightline-shop",
  customIdPrefix: "remedy-shop:",
  softDescriptor: "BRIGHTLINE SAMPLE",
  product: {
    sku: "BLH-PC10K",
    name: "Brightline PowerCell 10K power bank (sample)",
    description: "10,000 mAh portable power bank. A fictional sample product for the Remedy demo.",
    priceCents: 3499,
    currency: "USD",
  },
  label: "Demonstration in PayPal sandbox. Brightline Home is a fictional sample firm.",
} as const;

/** The shop's server routes, for the PayPal button component. */
export const SHOP_ROUTES = {
  createOrder: "/api/shop/orders",
  capture: (orderId: string) => `/api/shop/orders/${encodeURIComponent(orderId)}/capture`,
} as const;

/** `data` of POST /api/shop/orders. */
export type ShopOrderCreated = { id: string; status: string; approve_url: string | null; amount: string; product: { sku: string; name: string } };

/** `data` of POST /api/shop/orders/{id}/capture. */
export type ShopOrderCaptured = {
  order_id: string;
  status: string;
  already: boolean;
  capture_id: string | null;
  amount: string;
  sale_id: string;
  paid_at: string;
  payer_first_name: string | null;
  /** The owner can claim this purchase; a verified claim is refunded to this capture within 180 days. */
  refundable_until: string;
};
