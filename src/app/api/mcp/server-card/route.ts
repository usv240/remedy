import { connection } from "next/server";
import { CARD_TYPE, discoveryOptions, discoveryResponse, serverCard } from "@/lib/mcp/card";
import { publicOrigin } from "@/lib/origin";

/** GET /api/mcp/server-card: the MCP Server Card (SEP-2127) at the recommended <streamable-http-url>/server-card. */
export async function GET(req: Request) {
  await connection();
  return discoveryResponse(req, serverCard(publicOrigin(req)), CARD_TYPE);
}
export const OPTIONS = discoveryOptions;
