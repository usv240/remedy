import { connection } from "next/server";
import { liveSummary, runChecks } from "@/lib/health";

/**
 * GET /api/health: every integration and whether it is live, on its fallback, or an optional add-on that is off. `ok`
 * is the two services a claim cannot run without (PayPal and Postgres); `summary` counts live services, leaving
 * optional add-ons that are off out of the total.
 */
export async function GET() {
  await connection();
  const checks = await runChecks();
  const core = checks.filter((c) => c.id === "paypal" || c.id === "database");
  const sum = liveSummary(checks);
  return Response.json({ ok: core.every((c) => c.mode === "live"), summary: { live: sum.live, of: sum.of, optional_off: sum.optionalOff }, checks, at: new Date().toISOString() });
}
