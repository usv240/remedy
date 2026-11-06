import { SHOP } from "@/lib/payments/shop-catalog";
import { csvTemplate } from "@/lib/firm/buyers";

/** GET /api/firm/buyers/template: the sales CSV template, with two sample lines. */
export function GET() {
  return new Response(csvTemplate({ name: SHOP.product.name, sku: SHOP.product.sku }), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="remedy-sales-template.csv"' },
  });
}
