import { connection } from "next/server";
import stats from "../../../content/recalls/stats.json";
import { ENDPOINTS } from "@/lib/api/endpoints";
import { TOOLS } from "@/lib/mcp/tools";
import { publicOrigin } from "@/lib/origin";

/** GET /llms.txt: what Remedy is and how an AI assistant can use it, in plain text. */
export async function GET(req: Request) {
  await connection();
  const o = publicOrigin(req);
  const C = stats.current;
  const tools = TOOLS.map((t) => `- ${t.name}: ${t.description.split(". ")[0].replace(/\.$/, "")}.`).join("\n");
  const api = ENDPOINTS.filter((e) => e.keyed)
    .map((e) => `- ${e.method} ${e.path}: ${e.summary.split(". ")[0].replace(/\.$/, "")}.`)
    .join("\n");
  const text = `# Remedy

> Recall refunds in seconds. Many US product recalls offer a refund once the owner sends a photo showing the product made safe: the cord cut, the item cut in half, or "RECALLED" written on it. Remedy reads the official CPSC remedy as a checklist, verifies the owner's photo, and pays the refund through PayPal. It uses the CPSC's public recall data and is independent: not affiliated with the CPSC or any recalling firm. This deployment uses the PayPal sandbox; no real money moves.

${C.all.photoRefund.count} of the ${C.recalls.count} US consumer product recalls from ${C.range.from} to ${C.range.to} offer a refund for a photo of the product made safe (CPSC Recalls API).

## Connect

- MCP server (streamable HTTP): ${o}/api/mcp
- MCP Server Card: ${o}/api/mcp/server-card
- AI Catalog: ${o}/.well-known/ai-catalog.json
- REST API (OpenAPI 3.1): ${o}/openapi.json

## MCP tools

${tools}

## REST API

${api}

Reads need no key. A free sandbox key (Authorization: Bearer rm_test_...) raises the limits and turns on the full photo checks.

## How to help someone with a recall

1. Find the recall with search_recalls, using the product's name or brand.
2. Read what to do with get_proof_rule, and tell them the steps in plain words.
3. Give them their own claim link from open_claim. They take the photo and choose where the refund goes.

## Learn

- [Recalls](${o}/recalls): every recall since 2024, with its proof rule
- [How recalls work](${o}/learn): the glossary and how every number was counted
- [Developers](${o}/developers): keys, a live playground and docs
- [For judges](${o}/judges): the five-minute path and the results
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
