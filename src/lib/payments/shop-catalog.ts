/**
 * The sample shop's catalog, safe to import from client components (no server code here). Brightline Home is a
 * fictional sample firm; the charger is its sample product, sold only in the PayPal sandbox and recalled in its own
 * fictional sample recall BH-2026-01, so a visitor can buy it, claim it, and see the refund go back to that purchase.
 */
export const SHOP = {
  firmName: "Brightline Home (sample)",
  /** Marks shop orders at PayPal, so the capture route never captures any other order. */
  referenceId: "brightline-shop",
  customIdPrefix: "remedy-shop:",
  softDescriptor: "BRIGHTLINE SAMPLE",
  /** The sample recall this product is in. */
  recall: "BH-2026-01",
  product: {
    sku: "BLH-65W",
    name: "Brightline 65W laptop charger (sample)",
    description: "65W laptop charger with a fixed cord. A fictional sample product for the Remedy demo.",
    priceCents: 3499,
    currency: "USD",
    /** Public-domain photo of one real charger, brand marks removed (public/samples/charger/CREDITS.json). */
    image: "/samples/charger/intact.jpg",
    imageAlt: "A black laptop charger with its cord coiled beside it.",
    imageCredit: "Photo: Dmitry G, Wikimedia Commons, public domain. Brand marks removed; the product is a fictional sample.",
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
