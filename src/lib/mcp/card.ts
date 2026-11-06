/**
 * Pre-connection discovery for the Remedy MCP server (SEP-2127, MCP Server Cards): the card at
 * <streamable-http-url>/server-card, and the domain's AI Catalog at /.well-known/ai-catalog.json that points to it.
 * Cards carry identity and connection details only; tools are listed at runtime with tools/list.
 */
import { SERVER_INFO } from "./tools";

/** MCP protocol versions /api/mcp accepts, newest first. */
export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

export const CARD_TYPE = "application/mcp-server-card+json";
export const CATALOG_TYPE = "application/ai-catalog+json";

export function serverCard(origin: string) {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "io.github.usv240/remedy",
    version: SERVER_INFO.version,
    title: SERVER_INFO.title,
    description: "Recall refunds on a verified photo: search US product recalls, read a remedy as a proof rule, verify an owner's photo, and open a claim paid through PayPal (sandbox).",
    websiteUrl: `${origin}/developers`,
    repository: { url: "https://github.com/usv240/remedy", source: "github" },
    icons: [{ src: `${origin}/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }],
    remotes: [{ type: "streamable-http" as const, url: `${origin}/api/mcp`, supportedProtocolVersions: SUPPORTED_VERSIONS }],
  };
}

export function aiCatalog(origin: string) {
  const host = new URL(origin).hostname;
  return {
    specVersion: "1.0",
    entries: [{ identifier: `urn:air:${host}:mcp:remedy`, type: CARD_TYPE, url: `${origin}/api/mcp/server-card` }],
  };
}

/** Public, read-only discovery documents: open CORS, an hour of caching, and an ETag (docs/discovery.md, Hosting). */
export async function discoveryResponse(req: Request, body: unknown, type: string) {
  const text = JSON.stringify(body, null, 2);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const etag = `"${Buffer.from(digest).toString("base64url").slice(0, 22)}"`;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
    "Access-Control-Expose-Headers": "ETag",
    "Cache-Control": "public, max-age=3600",
    ETag: etag,
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(text, { status: 200, headers: { ...headers, "Content-Type": type } });
}

export const discoveryOptions = () =>
  new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Content-Type, If-None-Match", "Access-Control-Max-Age": "86400" },
  });
