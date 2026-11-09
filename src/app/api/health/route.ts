import { connection } from "next/server";
import { liveSummary, runChecks } from "@/lib/health";
import { addressSource } from "@/lib/ratelimit";

/**
 * GET /api/health: every integration and whether it is live, on its fallback, or an optional add-on that is off. `ok`
 * is the two services a claim cannot run without (PayPal and Postgres); `summary` counts live services, leaving
 * optional add-ons that are off out of the total. `request` names the header this request's client address was read
 * from (cf-connecting-ip behind Cloudflare), only the header's name and never the address.
 */
export async function GET(req: Request) {
  await connection();
  const checks = await runChecks();
  const core = checks.filter((c) => c.id === "paypal" || c.id === "database");
  const sum = liveSummary(checks);
  return Response.json({ ok: core.every((c) => c.mode === "live"), summary: { live: sum.live, of: sum.of, optional_off: sum.optionalOff }, checks, request: addressSource(req), at: new Date().toISOString() });
}
