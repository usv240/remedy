/**
 * A labelled sample of a PayPal Transaction Search answer (GET /v1/reporting/transactions, fields=all) for Brightline
 * Home's sample recall, so the buyers step of the console shows filled. No real Transaction Search response is recorded
 * in the repo, so this one is a sample, written in PayPal's own response shape and built from the sandbox test buyer
 * (the sandbox personal account TESTING.md publishes) buying the sample shop's charger. scripts/seed-firm.ts runs it
 * through the real search code (findBuyers in src/lib/payments/buyers.ts), which matches each cart line to the recalled
 * product, and saves what matched as sales marked SAMPLE_TS_MARK, which /firm/buyers labels as a sample.
 * No PayPal call is made, and no sample sale carries a capture id, so none can be refunded.
 */
import { SHOP } from "@/lib/payments/shop-catalog";

/** paypal_order_id on the sales this sample adds: how /firm/buyers knows to label them, and the seed to replace them. */
export const SAMPLE_TS_MARK = "sample:transaction-search";

const DAY = 86_400_000;
const price = (SHOP.product.priceCents / 100).toFixed(2);

/** The sample answer for the 30 days before `now`: three purchases of the sample shop's charger, at its price, by the sandbox buyer. */
export function sampleTransactionSearch(buyerEmail: string, now: Date) {
  const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString().replace(/\.\d{3}Z$/, "+0000");
  const tx = (n: number, days: number, item: { name: string; sku: string; value: string }) => ({
    transaction_info: {
      transaction_id: `SAMPLE-TS-${n}`,
      transaction_event_code: "T0006",
      transaction_initiation_date: at(days),
      transaction_amount: { currency_code: "USD", value: item.value },
      transaction_status: "S",
    },
    payer_info: { email_address: buyerEmail },
    cart_info: { item_details: [{ item_code: item.sku, item_name: item.name, item_quantity: "1", item_amount: { currency_code: "USD", value: item.value }, total_item_amount: { currency_code: "USD", value: item.value } }] },
  });
  const charger = { name: SHOP.product.name, sku: SHOP.product.sku, value: price };
  return {
    transaction_details: [tx(1, 21, charger), tx(2, 12, charger), tx(3, 4, charger)],
    account_number: "SAMPLE",
    total_items: 3,
    total_pages: 1,
    page: 1,
  };
}
