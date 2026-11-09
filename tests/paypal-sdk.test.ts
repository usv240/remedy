import { describe, expect, it } from "vitest";
import { FakePayPal } from "@/lib/payments/fake-paypal";
import { memoryLedger } from "@/lib/payments/deps";
import { refundCapture } from "@/lib/payments/refunds";
import { createShopOrder } from "@/lib/payments/shop";
import { MemoryStore } from "@/lib/payments/store";
import { restApi, sdkApi, toSdkShape, type Controllers } from "@/lib/paypal/sdk-rest";

/**
 * Orders and Payments are direct calls on the PayPal Server SDK's controllers (sdkApi), each carrying its
 * PayPal-Request-Id; tests make the same six calls over the fake PayPal's REST (restApi). No network.
 */
type Seen = { name: string; req: Record<string, unknown> };
function stubControllers(seen: Seen[], answer: (name: string) => { statusCode: number; body: unknown; headers?: Record<string, string> }): Controllers {
  const method =
    (name: string) =>
    async (req: Record<string, unknown>): Promise<unknown> => {
      seen.push({ name, req });
      const a = answer(name);
      return { statusCode: a.statusCode, body: JSON.stringify(a.body), headers: a.headers ?? {} };
    };
  const orders = { createOrder: method("createOrder"), getOrder: method("getOrder"), captureOrder: method("captureOrder") };
  const payments = { getCapturedPayment: method("getCapturedPayment"), refundCapturedPayment: method("refundCapturedPayment"), getRefund: method("getRefund") };
  return { orders: () => orders as never, payments: () => payments as never };
}

describe("Orders and Payments calls go through the PayPal Server SDK", () => {
  it("calls each controller method directly, with the attempt's PayPal-Request-Id and the body in the SDK's shape", async () => {
    const seen: Seen[] = [];
    const api = sdkApi(stubControllers(seen, (name) => ({ statusCode: name === "refundCapturedPayment" ? 201 : 200, body: { id: "X", status: "COMPLETED" }, headers: { "paypal-debug-id": "dbg-1" } })));
    const refund = await api.refundCapture<{ id: string }>("2GG279541U471931P", { amount: { value: "34.99", currency_code: "USD" }, note_to_payer: "Recall refund." }, { requestId: "refund-c1-a1" });
    expect(refund).toEqual({ status: 201, body: { id: "X", status: "COMPLETED" }, debugId: "dbg-1" });
    expect(seen[0].name).toBe("refundCapturedPayment");
    expect(seen[0].req).toMatchObject({ captureId: "2GG279541U471931P", paypalRequestId: "refund-c1-a1", prefer: "return=representation", body: { amount: { value: "34.99", currencyCode: "USD" }, noteToPayer: "Recall refund." } });

    await api.createOrder({ intent: "CAPTURE", purchase_units: [{ reference_id: "sale-1" }] }, { requestId: "shop-1" });
    expect(seen[1]).toMatchObject({ name: "createOrder", req: { paypalRequestId: "shop-1", body: { intent: "CAPTURE", purchaseUnits: [{ referenceId: "sale-1" }] } } });
    await api.captureOrder("5O190127TN364715T", { requestId: "shop-capture-5O190127TN364715T" });
    expect(seen[2]).toMatchObject({ name: "captureOrder", req: { id: "5O190127TN364715T", paypalRequestId: "shop-capture-5O190127TN364715T" } });
    await api.getOrder("5O190127TN364715T");
    await api.getCapture("2GG279541U471931P");
    await api.getRefund("1JU08902781691411");
    expect(seen.slice(3).map((s) => s.name)).toEqual(["getOrder", "getCapturedPayment", "getRefund"]);
    expect(seen[4].req).toEqual({ captureId: "2GG279541U471931P" });
  });

  it("returns PayPal's error body and status as an answer, not an exception", async () => {
    const { ApiError } = await import("@paypal/paypal-server-sdk");
    const ctrl: Controllers = {
      orders: () => ({}) as never,
      payments: () =>
        ({
          refundCapturedPayment: async () => {
            // The SDK's own error: the request, and PayPal's response with its status, headers and body as sent.
            throw new ApiError(
              { request: { url: "", method: "POST" }, response: { statusCode: 422, headers: { "paypal-debug-id": "dbg-2" }, body: JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "CAPTURE_FULLY_REFUNDED" }] }) } } as never,
              "",
            );
          },
        }) as never,
    };
    const r = await sdkApi(ctrl).refundCapture<{ details: { issue: string }[] }>("CAP", {}, { requestId: "refund-c2-a1" });
    expect(r.status).toBe(422);
    expect(r.body.details[0].issue).toBe("CAPTURE_FULLY_REFUNDED");
    expect(r.debugId).toBe("dbg-2");
  });

  it("gives the same six calls over a REST client, which is how the fake PayPal answers them", async () => {
    const pp = new FakePayPal();
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: "2026-11-01T00:00:00Z" });
    const api = restApi(pp.rest);
    const cap = await api.getCapture<{ id: string; status: string }>(captureId);
    expect(cap.body).toMatchObject({ id: captureId, status: "COMPLETED" });
    const r = await api.refundCapture<{ id: string }>(captureId, { amount: { value: "10.00", currency_code: "USD" } }, { requestId: "refund-x-a1" });
    expect(r.status).toBe(201);
    expect(pp.calls.at(-1)).toMatchObject({ method: "POST", path: `/v2/payments/captures/${captureId}/refund`, requestId: "refund-x-a1" });
    // The fake keeps header names in lower case, as HTTP treats them.
    expect(pp.calls.at(-1)?.headers).toMatchObject({ prefer: "return=representation" });
  });

  it("the engine's refund and shop order carry one PayPal-Request-Id per attempt through the SDK calls", async () => {
    const pp = new FakePayPal();
    const deps = { store: new MemoryStore(), ledger: memoryLedger().ledger, rest: pp.rest };
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: "2026-11-01T00:00:00Z" });
    const a = await refundCapture({ captureId, amountCents: 3499, requestId: "refund-c3-a1" }, deps);
    const b = await refundCapture({ captureId, amountCents: 3499, requestId: "refund-c3-a1" }, deps);
    expect(a.ok && b.ok && a.refundId === b.refundId, "the same attempt id returns the first refund").toBe(true);
    expect(pp.calls.filter((c) => c.path.endsWith("/refund")).map((c) => c.requestId)).toEqual(["refund-c3-a1", "refund-c3-a1"]);
    const order = await createShopOrder({ requestId: "shop-7" }, deps);
    expect(order.ok).toBe(true);
    expect(pp.calls.at(-1)).toMatchObject({ method: "POST", path: "/v2/checkout/orders", requestId: "shop-7" });
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
