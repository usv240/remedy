/**
 * Structured logging: one JSON line per event on stdout (info) or stderr (warn, error), with the request id, route
 * and duration of the API call it belongs to, so one request can be traced across the web service and the worker.
 *
 *   { "ts": "...", "level": "info", "msg": "request", "request_id": "req_...", "route": "POST /api/claims", "status": 200, "ms": 412 }
 *
 * Nothing private is written: every field is masked before it is printed (emails, phone numbers, photo bytes, keys
 * and secrets), and callers log ids (a claim, an order, a batch), never a payee or an amount to the cent for a payee.
 * Server only.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mask } from "./mask";
import { recordRequest } from "./ops/request-log";

export type Level = "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

type RequestContext = { requestId: string; route: string; started: number };
const als = new AsyncLocalStorage<RequestContext>();

/** The same shape the API envelope has always returned in meta.request_id. */
export const newRequestId = () => `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

const ID_SHAPE = /^[A-Za-z0-9_.-]{8,64}$/;

/** The caller's x-request-id when it is a plain token, else a new id. */
export function requestIdFrom(req: Request): string {
  const given = req.headers.get("x-request-id")?.trim() ?? "";
  return ID_SHAPE.test(given) ? given : newRequestId();
}

/** The request id of the API call this code runs inside, if any. */
export const currentRequestId = (): string | null => als.getStore()?.requestId ?? null;
export const currentRoute = (): string | null => als.getStore()?.route ?? null;

/** Run `fn` with a request context, so every log line inside it carries the id and route. */
export function runWithRequest<T>(ctx: { requestId: string; route: string }, fn: () => T): T {
  return als.run({ ...ctx, started: Date.now() }, fn);
}

// ---------------------------------------------------------------------------------------------------------------
// Writing (masking lives in src/lib/mask.ts, which the browser and edge bundles can load too)
// ---------------------------------------------------------------------------------------------------------------

export { mask } from "./mask";

/** Tests swap this to capture lines. */
let sink: ((level: Level, line: string) => void) | null = null;
export function setLogSink(fn: ((level: Level, line: string) => void) | null) {
  sink = fn;
}

export function write(level: Level, msg: string, fields: Fields = {}) {
  const ctx = als.getStore();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx ? { request_id: ctx.requestId, route: ctx.route } : {}),
    ...(mask(fields) as Record<string, unknown>),
  });
  if (sink) return sink(level, line);
  if (level === "info") process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
  if (level === "error" && process.env.SENTRY_DSN && fields.error instanceof Error) void reportToSentry(fields.error, msg, ctx?.requestId);
}

async function reportToSentry(error: Error, msg: string, requestId?: string) {
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, { tags: { log_msg: msg.slice(0, 80), request_id: requestId ?? "" } });
  } catch {
    /* error tracking is optional */
  }
}

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

// ---------------------------------------------------------------------------------------------------------------
// The API request wrapper
// ---------------------------------------------------------------------------------------------------------------

/**
 * Run an API handler inside a request context: the request id (from x-request-id when the caller sent one), one
 * "request" line with the route, status and duration, the request_log row, and x-request-id on the response.
 * A handler that throws is logged as a 500 and rethrown, so Next's own error handling still runs.
 */
export async function withRequest(req: Request, route: string, handler: () => Promise<Response>): Promise<Response> {
  const requestId = requestIdFrom(req);
  const started = Date.now();
  return als.run({ requestId, route, started }, async () => {
    let status = 500;
    try {
      const res = await handler();
      status = res.status;
      const headers = new Headers(res.headers);
      headers.set("x-request-id", requestId);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (e) {
      log.error("request failed", { error: e });
      throw e;
    } finally {
      const ms = Date.now() - started;
      write(status >= 500 ? "error" : "info", "request", { status, ms });
      recordRequest({ requestId, route, status, ms });
    }
  });
}
