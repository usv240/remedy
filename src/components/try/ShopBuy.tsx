"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SHOP, SHOP_ROUTES, type ShopOrderCaptured } from "@/lib/payments/shop-catalog";
import { SHOP_SALE_KEY, type StoredSale } from "@/components/claim/ClaimFlow";
import { day, money } from "@/components/claim/format";

/* Minimal typings for the PayPal JavaScript SDK v6 surface used here. */
type Session = { start: (opts: { presentationMode: "auto" | "popup" | "modal" | "redirect" }, order: Promise<{ orderId: string }>) => Promise<void> };
type SdkInstance = {
  findEligibleMethods: (o: { currencyCode: string }) => Promise<{ isEligible: (m: string) => boolean }>;
  createPayPalOneTimePaymentSession: (o: { onApprove: (d: { orderId: string }) => Promise<void> | void; onCancel?: (d: { orderId?: string }) => void; onError?: (e: Error) => void }) => Session;
};
type PayPalNs = { createInstance: (o: { clientId: string; components: string[]; pageType?: string; locale?: string }) => Promise<SdkInstance> };
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { type?: string; hidden?: boolean };
    }
  }
}

const SDK_SRC = "https://www.sandbox.paypal.com/web-sdk/v6/core";
let sdkPromise: Promise<{ sdk: SdkInstance; eligible: boolean }> | null = null;

function loadSdk(clientId: string) {
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    const w = window as unknown as { paypal?: PayPalNs };
    if (w.paypal) return resolve();
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("PayPal could not load."));
    document.head.appendChild(s);
  }).then(async () => {
    const sdk = await (window as unknown as { paypal: PayPalNs }).paypal.createInstance({ clientId, components: ["paypal-payments"], pageType: "checkout", locale: "en-US" });
    const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
    return { sdk, eligible: methods.isEligible("paypal") };
  });
  sdkPromise.catch(() => {
    sdkPromise = null;
  });
  return sdkPromise;
}

/**
 * Buy Brightline Home's sample power bank with the PayPal JavaScript SDK v6 button (Orders v2 on the server). On
 * approval the server captures it and stores the sale; this device keeps the sale and capture id, so the claim page
 * can link it and the refund can go back to this purchase.
 */
export function ShopBuy() {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "working" | "unavailable" | "failed">("loading");
  const [message, setMessage] = useState("");
  const [bought, setBought] = useState<ShopOrderCaptured | null>(null);
  const [attempt, setAttempt] = useState(0);
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

  useEffect(() => {
    if (!clientId) {
      // Configuration is fixed for the life of the page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("unavailable");
      return;
    }
    let cancelled = false;
    loadSdk(clientId)
      .then(({ sdk, eligible }) => {
        if (cancelled || !ref.current) return;
        if (!eligible) {
          setState("unavailable");
          return;
        }
        const session = sdk.createPayPalOneTimePaymentSession({
          async onApprove({ orderId }) {
            setState("working");
            setMessage("Completing your purchase");
            try {
              const r = await fetch(SHOP_ROUTES.capture(orderId), { method: "POST" });
              const j = await r.json().catch(() => null);
              if (!r.ok) {
                setState("ready");
                setMessage(j?.error?.message ?? "PayPal did not complete the purchase. Nothing was charged twice; please try again.");
                return;
              }
              const d = j.data as ShopOrderCaptured;
              try {
                const sale: StoredSale = { saleId: String(d.sale_id), captureId: d.capture_id ?? "", amount: d.amount, paidAt: d.paid_at };
                localStorage.setItem(SHOP_SALE_KEY, JSON.stringify(sale));
              } catch {
                /* storage unavailable: the claim page can still find the purchase by PayPal email */
              }
              setBought(d);
              setMessage("");
              setState("ready");
            } catch {
              setState("ready");
              setMessage("Your connection dropped while finishing the purchase. Please try again.");
            }
          },
          onCancel() {
            setState("ready");
            setMessage("Purchase canceled. Nothing was charged.");
          },
          onError() {
            setState("ready");
            setMessage("PayPal stopped before the purchase finished. Nothing was charged; please try again.");
          },
        });
        const btn = ref.current;
        btn.removeAttribute("hidden");
        btn.onclick = () => {
          setMessage("");
          // Start the session inside the click, so the browser lets PayPal open.
          const order = fetch(SHOP_ROUTES.createOrder, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
            .then((r) => r.json().then((j) => ({ r, j })))
            .then(({ r, j }) => {
              if (!r.ok) throw new Error(j?.error?.message ?? "Could not start the purchase.");
              return { orderId: j.data.id as string };
            });
          order.catch((e: Error) => setMessage(e.message));
          session.start({ presentationMode: "auto" }, order).catch(() => setMessage("PayPal stopped before the purchase finished. Nothing was charged."));
        };
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, attempt]);

  if (bought) {
    return (
      <div className="tr-bought" role="status">
        <p className="pill" data-tone="paid">
          Paid
        </p>
        <h2 className="tr-bought-title">You bought the sample power bank.</h2>
        <p>
          <span className="tabular">{money(bought.amount)}</span> on {day(bought.paid_at)}, with PayPal in the sandbox
          {bought.payer_first_name ? `, ${bought.payer_first_name}` : ""}. It can be refunded to this payment until {day(bought.refundable_until)}.
        </p>
        <p className="tabular cl-hint">Sandbox capture ID {bought.capture_id}</p>
        <p>
          <Link className="btn btn-primary cl-send" href="/claim/27056">
            Now claim it
          </Link>
        </p>
        <p className="cl-hint">On the claim page, the purchase from this device is linked for you, so a verified claim is refunded to it.</p>
      </div>
    );
  }

  return (
    <div className="pp-wrap">
      <paypal-button ref={ref} type="pay" hidden className="pp-button" aria-describedby="shop-what" />
      {state === "loading" && <p className="pp-slot">Loading PayPal</p>}
      {state === "failed" && (
        <p className="pp-slot" role="status">
          PayPal could not load.{" "}
          <button type="button" className="cl-textbtn" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {state === "unavailable" && <p className="pp-note">PayPal checkout is not set up on this server.</p>}
      {message && (
        <p className="pp-note" data-tone={state === "working" ? undefined : "attention"} role="status">
          {message}
        </p>
      )}
      <p className="pp-note">{SHOP.label}</p>
    </div>
  );
}
