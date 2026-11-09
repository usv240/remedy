/**
 * Every raw PayPal call goes through paypalFetch: each attempt has a 15-second timeout, and a call that times out is
 * sent once more only where a second send cannot pay twice: a read (GET), the OAuth token request, or a write that
 * carries a PayPal-Request-Id, sent again with that same id. A write without one is not repeated. When the second
 * attempt times out too, the caller gets a PayPalTimeoutError and decides (the payouts code then waits and checks the
 * same batch id again rather than sending a new one). The Server SDK gets the same rule through its own retry settings
 * (SDK_HTTP below, used by src/lib/paypal/client.ts and firm-account.ts). No imports, so tests use it as is.
 */
export const PAYPAL_TIMEOUT_MS = 15_000;

/**
 * The Server SDK's HTTP settings: the same 15-second timeout, and one retry on a timeout or dropped connection for GET
 * and POST. Every POST the SDK makes carries a PayPal-Request-Id (src/lib/paypal/sdk-rest.ts fills one in when a
 * caller has none), and the retry resends the same request, so PayPal answers it with the first result. Status codes
 * are not retried here; the payments engine decides those itself. Wait times are in seconds.
 */
export const SDK_HTTP = {
  timeout: PAYPAL_TIMEOUT_MS,
  retryConfig: { maxNumberOfRetries: 1, retryOnTimeout: true, retryInterval: 1, backoffFactor: 1, maximumRetryWaitTime: 5, httpStatusCodesToRetry: [] as number[], httpMethodsToRetry: ["GET" as const, "POST" as const] },
};

export class PayPalTimeoutError extends Error {
  constructor(
    readonly path: string,
    readonly attempts: number,
    timeoutMs = PAYPAL_TIMEOUT_MS,
  ) {
    super(`PayPal did not answer ${path} within ${Math.round(timeoutMs / 1000)} s (${attempts} ${attempts === 1 ? "attempt" : "attempts"})`);
    this.name = "PayPalTimeoutError";
  }
}

export const isPayPalTimeout = (e: unknown): e is PayPalTimeoutError => e instanceof Error && e.name === "PayPalTimeoutError";

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** Safe to send again after a timeout: it only reads, asks for a token, or carries a PayPal-Request-Id. */
export function canRepeat(url: string, init: RequestInit = {}): boolean {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  if (pathOf(url).endsWith("/v1/oauth2/token")) return true;
  return Boolean(new Headers(init.headers).get("PayPal-Request-Id"));
}

const timedOut = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** fetch with a timeout on each attempt, and one more attempt after a timeout where canRepeat allows it. */
export async function paypalFetch(url: string, init: RequestInit = {}, o: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<Response> {
  const f = o.fetch ?? fetch;
  const ms = o.timeoutMs ?? PAYPAL_TIMEOUT_MS;
  // The same init each time: the same method, headers (so the same PayPal-Request-Id) and body.
  const attempt = () => f(url, { ...init, signal: AbortSignal.timeout(ms) });
  try {
    return await attempt();
  } catch (e) {
    if (!timedOut(e)) throw e;
    if (!canRepeat(url, init)) throw new PayPalTimeoutError(pathOf(url), 1, ms);
  }
  try {
    return await attempt();
  } catch (e) {
    if (timedOut(e)) throw new PayPalTimeoutError(pathOf(url), 2, ms);
    throw e;
  }
}
