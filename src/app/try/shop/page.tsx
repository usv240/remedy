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
  title: "Buy the sample power bank",
  description: "Buy Brightline Home's fictional sample power bank with PayPal in the sandbox, then claim it and see the refund go back to that payment.",
};

/** A drawing of the fictional product: a plain power bank, no brand. */
function PowerBank() {
  return (
    <svg viewBox="0 0 200 150" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="40" y="22" width="120" height="106" rx="18" />
        <path d="M70 22v-8h60v8" />
        <path d="M60 104h80" opacity="0.4" />
        <circle cx="68" cy="56" r="4" />
        <circle cx="84" cy="56" r="4" />
        <circle cx="100" cy="56" r="4" />
        <circle cx="116" cy="56" r="4" opacity="0.35" />
        <path d="M96 76l-8 14h12l-8 14" />
      </g>
    </svg>
  );
}

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
          <h1 className="page-title tr-title">Buy the sample power bank</h1>
          <ClaimInfo k="try.shop" topic="the sample shop" />
        </div>
        <p className="lede">Buy it with PayPal in the sandbox, then claim it. A verified claim is refunded to this same payment.</p>
      </header>

      <div className="tr-shop-grid">
        <section className="app-sheet tr-product" aria-labelledby="shop-name">
          <div className="tr-product-art">
            <PowerBank />
          </div>
          <h2 id="shop-name" className="tr-product-name">
            {SHOP.product.name}
          </h2>
          <p id="shop-what">{SHOP.product.description}</p>
          <p className="tr-price tabular">${(SHOP.product.priceCents / 100).toFixed(2)}</p>
          <p className="cl-hint">
            Sold by {SHOP.firmName}. In this demo it stands in for the recalled HAIARA power bank (CPSC recall 27056), so the claim, the checks and the refund to this payment can all be tried.
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
