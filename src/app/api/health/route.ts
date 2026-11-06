import { connection } from "next/server";
import { runChecks } from "@/lib/health";

/** GET /api/health: every integration and whether it is live or using its fallback. */
export async function GET() {
  await connection();
  const checks = await runChecks();
  const core = checks.filter((c) => c.id === "paypal" || c.id === "database");
  return Response.json({ ok: core.every((c) => c.mode === "live"), checks, at: new Date().toISOString() });
}
