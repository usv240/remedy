import { connection } from "next/server";
import { CATALOG_TYPE, aiCatalog, discoveryOptions, discoveryResponse } from "@/lib/mcp/card";
import { publicOrigin } from "@/lib/origin";

/** GET /.well-known/ai-catalog.json (rewritten here): the domain's AI Catalog, pointing to the MCP Server Card. */
export async function GET(req: Request) {
  await connection();
  return discoveryResponse(req, aiCatalog(publicOrigin(req)), CATALOG_TYPE);
}
export const OPTIONS = discoveryOptions;
