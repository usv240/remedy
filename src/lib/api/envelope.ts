export type ApiErrorCode = "invalid_request" | "rate_limited" | "unauthorized" | "not_found" | "upstream_unavailable" | "internal";

/** The API's version date. Every response carries it in meta.version. */
export const API_VERSION = "2026-11-05";

const DOCS = "/developers/docs#errors";
const requestId = () => `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

/** Every success has the same shape: { data, meta, error: null }. */
export function ok<T>(data: T, started: number, extra: Record<string, unknown> = {}) {
  return Response.json({
    data,
    meta: { request_id: requestId(), version: API_VERSION, latency_ms: Date.now() - started, ...extra },
    error: null,
  });
}

/** Every error has the same shape: { data: null, meta, error: { code, message, docs, details } }, with a plain message. */
export function fail(code: ApiErrorCode, message: string, status: number, details?: unknown) {
  return Response.json(
    {
      data: null,
      meta: { request_id: requestId(), version: API_VERSION },
      error: { code, message, docs: `${DOCS}-${code}`, details },
    },
    { status },
  );
}

/** Today's date in US Pacific time, YYYY-MM-DD. */
export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}
