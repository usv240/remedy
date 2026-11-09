import { connection } from "next/server";
import { ok } from "@/lib/api/envelope";
import { v1Index } from "@/lib/api/endpoints";
import { publicOrigin } from "@/lib/origin";

/** GET /api/v1: the v1 endpoints, each with its method, path, one line and its docs link. No key needed. */
export async function GET(req: Request) {
  await connection();
  const started = Date.now();
  return ok(v1Index(publicOrigin(req)), started);
}
