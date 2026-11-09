import { describe, expect, it } from "vitest";
import { memoryLedger } from "@/lib/payments/deps";
import { FakePayPal } from "@/lib/payments/fake-paypal";
import { createPayoutBatch, getPayoutBatch } from "@/lib/payments/payouts";
import { MemoryStore } from "@/lib/payments/store";
import type { Rest } from "@/lib/payments/types";
import { restFor } from "@/lib/paypal/firm-account";
import { canRepeat, PAYPAL_TIMEOUT_MS, paypalFetch, PayPalTimeoutError, SDK_HTTP } from "@/lib/paypal/http";

/**
 * Every PayPal call has a timeout, and a call that times out is sent once more only where that cannot pay twice: a read,
 * the token request, or a write that carries a PayPal-Request-Id, resent with the same id. Run against the fake PayPal
 * through a fetch that can hang, the way a slow network does: before PayPal does the work, or after it, with the answer
 * lost on the way back. No network.
 */
const CREDS = { clientId: "FIRMCLIENTID0000000000001", secret: "FIRMSECRET000000000000001" };
const MS = 40;

type Hang = { path: RegExp; when: "before" | "after"; times: number };

/** A fetch over the fake PayPal's REST: the token request answers here, everything else goes to the fake. */
function fakeFetch(pp: FakePayPal, hangs: Hang[] = []) {
  const seen: { method: string; path: string; requestId: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    seen.push({ method, path: url.pathname, requestId: headers.get("PayPal-Request-Id") });
    const hang = hangs.find((h) => h.times > 0 && h.path.test(url.pathname));
    const wait = () =>
      new Promise<never>((_, reject) => {
        const s = init.signal!;
        if (s.aborted) reject(s.reason);
        s.addEventListener("abort", () => reject(s.reason), { once: true });
      });
    if (hang?.when === "before") {
      hang.times--;
      return wait();
    }
    let status = 200;
    let body: unknown = { access_token: "fake-token", expires_in: 3600 };
    if (!url.pathname.endsWith("/v1/oauth2/token")) {
      const r = await pp.rest(url.pathname + url.search, { method, body: init.body as string | undefined, requestId: headers.get("PayPal-Request-Id") ?? undefined });
      status = r.status;
      body = r.body;
    }
    if (hang?.when === "after") {
      hang.times--;
      return wait();
    }
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "paypal-debug-id": "fake-debug" } });
  }) as typeof fetch;
  return { f, seen };
}

/** restFor with a short timeout in place of the 15-second one, so the hangs end quickly. */
function restWith(pp: FakePayPal, hangs: Hang[]) {
  const { f, seen } = fakeFetch(pp, hangs);
  const timed = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    // paypalFetch gives each attempt its own 15 s signal; swap in a short one with the same behavior.
    const signal = AbortSignal.timeout(MS);
    return f(input, { ...init, signal });
  }) as typeof fetch;
  return { rest: restFor(CREDS, timed) as Rest, seen };
}

const line = { claimId: "c-timeout-1", amountCents: 3499, payee: { type: "email" as const, value: "owner@example.com" }, recallNumber: "BH-2026-01", recallTitle: "Sample charger" };
const depsOf = (rest: Rest) => ({ store: new MemoryStore(), ledger: memoryLedger().ledger, rest, firm: { id: null, name: "Brightline Home (sample)" } });

describe("PayPal timeouts", () => {
  it("every call has about 15 s, on raw fetch and on the Server SDK, and the SDK retries once on a timeout", () => {
    expect(PAYPAL_TIMEOUT_MS).toBe(15_000);
    expect(SDK_HTTP.timeout).toBe(PAYPAL_TIMEOUT_MS);
    expect(SDK_HTTP.retryConfig).toMatchObject({ maxNumberOfRetries: 1, retryOnTimeout: true, httpStatusCodesToRetry: [] });
    expect(SDK_HTTP.retryConfig.httpMethodsToRetry).toEqual(["GET", "POST"]);
  });

  it("only a read, the token request or a write with a PayPal-Request-Id is sent again", () => {
    const u = "https://api-m.sandbox.paypal.com";
    expect(canRepeat(`${u}/v1/payments/payouts/B1`, { method: "GET" })).toBe(true);
    expect(canRepeat(`${u}/v1/oauth2/token`, { method: "POST" })).toBe(true);
    expect(canRepeat(`${u}/v1/payments/payouts`, { method: "POST", headers: { "PayPal-Request-Id": "rmd-c1-a1" } })).toBe(true);
    expect(canRepeat(`${u}/v1/payments/payouts-item/I1/cancel`, { method: "POST" })).toBe(false);
  });

  it("a read that hangs once is sent again and answers", async () => {
    const pp = new FakePayPal();
    const { rest, seen } = restWith(pp, []);
    const made = await createPayoutBatch([line], { senderBatchId: "rmd-c-timeout-1-a1" }, depsOf(rest));
    expect(made.ok).toBe(true);
    const { rest: slow, seen: seen2 } = restWith(pp, [{ path: /^\/v1\/payments\/payouts\/[A-Z0-9]+$/, when: "before", times: 1 }]);
    const b = await getPayoutBatch(made.ok ? made.payoutBatchId : "", depsOf(slow));
    expect(b.ok).toBe(true);
    expect(seen2.filter((s) => s.method === "GET" && s.path.startsWith("/v1/payments/payouts/")).length).toBe(2);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("a payout whose answer is lost is sent once more with the same PayPal-Request-Id, and PayPal pays it once", async () => {
    const pp = new FakePayPal();
    const { rest, seen } = restWith(pp, [{ path: /^\/v1\/payments\/payouts$/, when: "after", times: 1 }]);
    const r = await createPayoutBatch([line], { senderBatchId: "rmd-c-timeout-1-a1" }, depsOf(rest));
    // PayPal made the batch on the first send; the resend is refused as a repeat and names that batch.
    expect(r).toMatchObject({ ok: true, existing: true });
    expect(pp.batches.size).toBe(1);
    expect(r.ok && r.payoutBatchId).toBe([...pp.batches.keys()][0]);
    const sends = seen.filter((s) => s.method === "POST" && s.path === "/v1/payments/payouts");
    expect(sends.map((s) => s.requestId)).toEqual(["rmd-c-timeout-1-a1", "rmd-c-timeout-1-a1"]);
  });

  it("a payout that hangs on both sends is not sent a third time, and says to check the same batch first", async () => {
    const pp = new FakePayPal();
    const { rest, seen } = restWith(pp, [{ path: /^\/v1\/payments\/payouts$/, when: "before", times: 5 }]);
    const r = await createPayoutBatch([line], { senderBatchId: "rmd-c-timeout-1-a1" }, depsOf(rest));
    expect(r).toMatchObject({ ok: false, issue: "TIMEOUT", status: 504, definite: false });
    expect(r.ok ? "" : r.plain).toMatch(/never sent twice/);
    expect(seen.filter((s) => s.method === "POST" && s.path === "/v1/payments/payouts").length).toBe(2);
    expect(pp.batches.size).toBe(0);
  });

  it("a write with no PayPal-Request-Id is not repeated after a timeout", async () => {
    let calls = 0;
    const hang = ((_u: RequestInfo | URL, init: RequestInit = {}) => {
      calls++;
      return new Promise<never>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    }) as typeof fetch;
    await expect(paypalFetch("https://api-m.sandbox.paypal.com/v1/payments/payouts-item/I1/cancel", { method: "POST" }, { fetch: hang, timeoutMs: MS })).rejects.toBeInstanceOf(PayPalTimeoutError);
    expect(calls).toBe(1);
    calls = 0;
    await expect(paypalFetch("https://api-m.sandbox.paypal.com/v1/payments/payouts/B1", { method: "GET" }, { fetch: hang, timeoutMs: MS })).rejects.toThrow(/2 attempts/);
    expect(calls).toBe(2);
  });
});
