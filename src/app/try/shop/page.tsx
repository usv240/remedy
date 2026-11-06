import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { SandboxLogin } from "@/components/SandboxLogin";
import { ShopBuy } from "@/components/try/ShopBuy";
import { SHOP } from "@/lib/payments/shop-catalog";
import "../../pages.css";
import "@/components/claim/claim.css";
import "@/components/try/try.css";

export const metadata: Metadata = {
  title: "Buy the sample charger",
  description: "Buy Brightline Home's fictional sample laptop charger with PayPal in the sandbox, then claim it and see the refund go back to that payment.",
};

export default function ShopPage() {
  return (
    <div className="page frame tr-shop">
      <p className="cl-crumbs" data-ui>
        <Link className="text-link" href="/try">
          Try a photo
        </Link>
      </p>
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title tr-title">Buy the sample charger</h1>
          <ClaimInfo k="try.shop" topic="the sample shop" />
        </div>
        <p className="lede">Buy it with PayPal in the sandbox, then claim it. A verified claim is refunded to this same payment.</p>
      </header>

      <div className="tr-shop-grid">
        <section className="app-sheet tr-product" aria-labelledby="shop-name">
          <figure className="tr-product-art">
            {/* eslint-disable-next-line @next/next/no-img-element -- a sample photo served from /public */}
            <img src={SHOP.product.image} alt={SHOP.product.imageAlt} width={800} height={600} />
            <figcaption className="muted">{SHOP.product.imageCredit}</figcaption>
          </figure>
          <h2 id="shop-name" className="tr-product-name">
            {SHOP.product.name}
          </h2>
          <p id="shop-what">{SHOP.product.description}</p>
          <p className="tr-price tabular">${(SHOP.product.priceCents / 100).toFixed(2)}</p>
          <p className="cl-hint">
            Sold by {SHOP.firmName}, and recalled in Brightline&rsquo;s own sample recall, {SHOP.recall}, so the claim, the checks and the refund to this payment can all be tried. Sample recall; the firm and the recall are fictional.
          </p>
        </section>

        <section className="app-sheet tr-buy" aria-labelledby="shop-pay">
          <h2 id="shop-pay" className="tr-product-name">
            Pay with PayPal
          </h2>
          <ShopBuy />
          <div>
            <p className="cl-hint">Log in to PayPal with the sandbox buyer account:</p>
            <Suspense fallback={<p className="cl-hint">Loading the sandbox login</p>}>
              <SandboxLogin compact />
            </Suspense>
          </div>
          <p className="cl-hint">Sandbox money only: nothing real is charged. The refund window is PayPal&rsquo;s 180 days from the purchase.</p>
        </section>
      </div>
    </div>
  );
}
