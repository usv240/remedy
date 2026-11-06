import { describe, expect, it } from "vitest";
import { sdkRoute, toSdkShape } from "@/lib/paypal/sdk-rest";

describe("Orders and Payments calls go through the PayPal Server SDK", () => {
  it("maps each Orders and Payments path to its SDK call, and leaves the rest on REST", () => {
    expect(sdkRoute("/v2/checkout/orders", "POST")).toEqual({ op: "createOrder" });
    expect(sdkRoute("/v2/checkout/orders/5O190127TN364715T", "GET")).toEqual({ op: "getOrder", id: "5O190127TN364715T" });
    expect(sdkRoute("/v2/checkout/orders/5O190127TN364715T/capture", "POST")).toEqual({ op: "captureOrder", id: "5O190127TN364715T" });
    expect(sdkRoute("/v2/payments/captures/2GG279541U471931P", "GET")).toEqual({ op: "getCapturedPayment", id: "2GG279541U471931P" });
    expect(sdkRoute("/v2/payments/captures/2GG279541U471931P/refund", "POST")).toEqual({ op: "refundCapturedPayment", id: "2GG279541U471931P" });
    expect(sdkRoute("/v2/payments/refunds/1JU08902781691411", "GET")).toEqual({ op: "getRefund", id: "1JU08902781691411" });
    // Not in the SDK: Payouts, Transaction Search, Disputes.
    expect(sdkRoute("/v1/payments/payouts", "POST")).toBeNull();
    expect(sdkRoute("/v1/reporting/transactions?start_date=x", "GET")).toBeNull();
    expect(sdkRoute("/v1/customer/disputes?disputed_transaction_id=x", "GET")).toBeNull();
  });

  it("turns PayPal's JSON names into the SDK's property names at every depth, leaving values alone", () => {
    const body = {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: "sale-1", amount: { currency_code: "USD", value: "34.99" }, custom_id: "BH-2026-01" }],
      payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", return_url: "https://x/r" } } },
    };
    expect(toSdkShape(body)).toEqual({
      intent: "CAPTURE",
      purchaseUnits: [{ referenceId: "sale-1", amount: { currencyCode: "USD", value: "34.99" }, customId: "BH-2026-01" }],
      paymentSource: { paypal: { experienceContext: { shippingPreference: "NO_SHIPPING", returnUrl: "https://x/r" } } },
    });
    expect(toSdkShape({ address: { address_line_1: "1 Main" } })).toEqual({ address: { addressLine1: "1 Main" } });
  });
});
