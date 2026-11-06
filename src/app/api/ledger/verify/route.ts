import { connection } from "next/server";
import { verifyLedger } from "@/lib/audit";

/** GET /api/ledger/verify: recompute the audit ledger's hash chain from the first event. */
export async function GET() {
  await connection();
  return Response.json({ data: await verifyLedger(), error: null });
}
