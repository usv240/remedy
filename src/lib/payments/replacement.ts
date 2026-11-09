import { recallLabel } from "@/lib/recall/label";
import { SANDBOX_LABEL, resolveDeps, toValue, type PaymentsDeps } from "./deps";
import { captureStatus, plainIssue } from "./status";
import type { Replacement } from "./types";

/**
 * A safe replacement, paid with Orders v2. The payee is the retailer stand-in (the sandbox vendor account in
 * PAYPAL_VENDOR_EMAIL); the firm pays it, so the owner gets the product instead of cash. In the sandbox the firm's
 * side is PayPal's public test card, which completes the order in one server call with no login. A firm on live
 * PayPal would approve the same order with its own PayPal account.
 */
export const SANDBOX_TEST_CARD = { number: "4012888888881881", expiry: "2030-12", name: "Brightline Home Sample", security_code: "123" } as const;

type OrderBody = {
  id?: string;
  status?: string;
  name?: string;
  details?: { issue?: string }[];
  debug_id?: string;
  purchase_units?: { payments?: { captures?: { id?: string; status?: string }[] } }[];
};

export function replacementOrderBody(o: { claimId: string; recallNumber: string; replacement: Replacement; retailerEmail: string }) {
  const value = toValue(o.replacement.priceCents);
  const title = o.replacement.title.slice(0, 120);
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: `claim-${o.claimId}`.slice(0, 256),
        custom_id: `remedy-replacement:${o.claimId}`.slice(0, 127),
        description: `Safe replacement for ${recallLabel(o.recallNumber)}. ${SANDBOX_LABEL}`.slice(0, 127),
        amount: { currency_code: "USD", value, breakdown: { item_total: { currency_code: "USD", value } } },
        items: [{ name: title, sku: o.replacement.productId.slice(0, 127), quantity: "1", unit_amount: { currency_code: "USD", value }, category: "PHYSICAL_GOODS" }],
        payee: { email_address: o.retailerEmail },
      },
    ],
    payment_source: { card: SANDBOX_TEST_CARD },
  };
}

export async function payReplacement(
  o: { claimId: string; requestId: string; recallNumber: string; replacement: Replacement },
  partial?: Partial<PaymentsDeps>,
): Promise<
  | { ok: true; orderId: string; captureId: string | null; paypalStatus: string; status: ReturnType<typeof captureStatus>; debugId: string | null }
  | { ok: false; issue: string; plain: string; status: number; debugId: string | null; definite: boolean }
> {
  const deps = await resolveDeps(partial);
  const retailerEmail = process.env.PAYPAL_VENDOR_EMAIL?.trim();
  if (!retailerEmail) return { ok: false, issue: "NO_RETAILER", plain: "The sample retailer is not set up on this server, so a replacement cannot be ordered.", status: 503, debugId: null, definite: true };
  // ordersController.createOrder, on the SDK; the attempt's PayPal-Request-Id makes a retry return the first order.
  const body = replacementOrderBody({ ...o, retailerEmail });
  const call = () => deps.paypal.createOrder<OrderBody>(body, { requestId: o.requestId });
  let r = await call().catch(() => ({ status: 599, body: { name: "NETWORK_ERROR" } as OrderBody, debugId: null }));
  for (let i = 1; r.status >= 500 && i <= 2; i++) {
    await new Promise((res) => setTimeout(res, 700 * i));
    r = await call().catch(() => ({ status: 599, body: { name: "NETWORK_ERROR" } as OrderBody, debugId: null }));
  }
  const cap = r.body.purchase_units?.[0]?.payments?.captures?.[0];
  if (r.status < 400 && r.body.id) {
    return { ok: true, orderId: r.body.id, captureId: cap?.id ?? null, paypalStatus: cap?.status ?? r.body.status ?? "CREATED", status: captureStatus(cap?.status ?? (r.body.status === "COMPLETED" ? "COMPLETED" : "PENDING")), debugId: r.debugId };
  }
  const issue = r.body.details?.[0]?.issue ?? r.body.name ?? "PAYPAL_ERROR";
  return { ok: false, issue, plain: plainIssue(issue), status: r.status, debugId: r.debugId ?? r.body.debug_id ?? null, definite: r.status >= 400 && r.status < 500 };
}
