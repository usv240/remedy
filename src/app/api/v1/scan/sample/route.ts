import { connection } from "next/server";
import { ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { sampleCatalog } from "@/lib/recall/scan-sample";

/** GET /api/v1/scan/sample: a small catalog of real recalls and clear items, ready to send to POST /api/v1/scan. */
export async function GET(req: Request) {
  await connection();
  return guard(req, "v1.scan.sample", async () => {
    const started = Date.now();
    return ok(sampleCatalog(), started);
  });
}
