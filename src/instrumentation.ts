/**
 * Runs once when a server starts (Next.js instrumentation). Error tracking (@sentry/nextjs) is set up here for the
 * Node and edge runtimes, and only when SENTRY_DSN is set: without it nothing changes. onRequestError hands every
 * unhandled request error to Sentry with the request id, if a DSN is set.
 */
import type { Instrumentation } from "next";

export async function register() {
  if (!process.env.SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, request, context);
};
