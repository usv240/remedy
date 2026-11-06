/** Shared request helpers for the claims routes: the error envelope for ClaimError, and the end-to-end test guard. */
import { timingSafeEqual } from "node:crypto";
import { fail } from "@/lib/api/envelope";
import { log } from "@/lib/log";
import { allowPicture, clientIp } from "@/lib/ratelimit";
import { ClaimError } from "./claims";

export function failFrom(e: unknown) {
  if (e instanceof ClaimError) return fail(e.code, e.message, e.status);
  log.error("claims route failed", { error: e });
  return fail("internal", "Something went wrong on our side. Please try again in a minute.", 500);
}

/** True when the request carries this server's CHECKS_SECRET (end-to-end tests only). Never true without one set. */
export function isTestRequest(req: Request): boolean {
  const secret = process.env.CHECKS_SECRET?.trim();
  const got = req.headers.get("x-checks-secret")?.trim();
  if (!secret || !got) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A light per-visitor limit for routes that serve pictures (a preset's photo, a claim's photo), counted in Postgres
 * (src/lib/ratelimit.ts) so it holds across instances: a page of thumbnails does not use up the API's 20-a-minute
 * demo tier, yet no visitor can hammer the route.
 */
export async function pictureLimit(req: Request, perMinute = 120): Promise<Response | null> {
  const w = await allowPicture(clientIp(req), perMinute);
  if (w.ok) return null;
  const res = fail("rate_limited", "Too many requests this minute. Please wait a moment and try again.", 429);
  return new Response(res.body, { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(w.retryAfterSec) } });
}

export const hasApiKey = (req: Request) => Boolean(req.headers.get("authorization")?.toLowerCase().startsWith("bearer ") || req.headers.get("x-api-key"));
