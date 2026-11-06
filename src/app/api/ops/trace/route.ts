import { connection } from "next/server";
import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { isRequestId, trace } from "@/lib/ops/data";

/**
 * GET /api/ops/trace?id=req_...: everything one request id touched, for the trace box on /ops: its request_log rows
 * (route, status, duration) and the ledger entries written under it. Public and masked: no bodies, no payees.
 */
export async function GET(req: Request) {
  await connection();
  return guard(req, "GET /api/ops/trace", async () => {
    const started = Date.now();
    const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
    if (!isRequestId(id)) return fail("invalid_request", "Paste a request id as the API returns it, for example req_3f2a9c1e7b4d.", 400);
    return ok(await trace(id), started);
  });
}
