import { openapi } from "@/lib/api/openapi";
import { publicOrigin } from "@/lib/origin";

/** GET /openapi.json: the API description, generated from the Zod schemas. */
export function GET(req: Request) {
  return Response.json(openapi(publicOrigin(req)), { headers: { "Access-Control-Allow-Origin": "*" } });
}
