/**
 * Error tracking (Sentry), shared by the server, edge and client configs. On only when a DSN is set: without one
 * every init is skipped and nothing changes. Nothing personal is sent: sendDefaultPii is off, and beforeSend
 * scrubs emails, phone numbers, photo data and secret-looking values from every event before it leaves. The
 * release is the git commit Render built (RENDER_GIT_COMMIT), the environment Render's service name or "local".
 */
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { mask } from "./mask";

export type SentryOptions = {
  dsn: string;
  environment: string;
  release?: string;
  sendDefaultPii: false;
  tracesSampleRate: number;
  beforeSend: (event: ErrorEvent, hint: EventHint) => ErrorEvent | null;
};

export const sentryEnvironment = (env: Record<string, string | undefined> = process.env) => env.SENTRY_ENVIRONMENT || (env.RENDER ? env.RENDER_SERVICE_NAME || "render" : env.NODE_ENV === "production" ? "production" : "local");
export const sentryRelease = (env: Record<string, string | undefined> = process.env) => env.SENTRY_RELEASE || env.RENDER_GIT_COMMIT || env.NEXT_PUBLIC_GIT_COMMIT || undefined;

/** Strip personal data from an event: masked copies of every message, exception value, breadcrumb and extra. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const out = event;
  if (out.message) out.message = String(mask(out.message));
  if (out.exception?.values) for (const v of out.exception.values) if (v.value) v.value = String(mask(v.value));
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map((b) => ({ ...b, message: b.message ? String(mask(b.message)) : b.message, data: b.data ? (mask(b.data) as Record<string, unknown>) : b.data }));
  if (out.extra) out.extra = mask(out.extra) as Record<string, unknown>;
  if (out.contexts) out.contexts = mask(out.contexts) as ErrorEvent["contexts"];
  if (out.request) {
    // Bodies hold photos; cookies and headers can hold keys. Keep the method and the route only.
    out.request = { method: out.request.method, url: out.request.url?.split("?")[0] };
  }
  delete out.user;
  delete out.server_name;
  return out;
}

export function sentryOptions(dsn = process.env.SENTRY_DSN): SentryOptions | null {
  if (!dsn?.trim()) return null;
  return {
    dsn: dsn.trim(),
    environment: sentryEnvironment(),
    release: sentryRelease(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  };
}
