import { z } from "zod";
import { guard } from "@/lib/api/keys";
import { keyIdFor } from "@/lib/api/verify-service";
import { log } from "@/lib/log";
import { INSTRUCTIONS, SERVER_INFO, TOOLS, type Ctx, type ToolResult } from "@/lib/mcp/tools";
import { publicOrigin } from "@/lib/origin";
import { SUPPORTED_VERSIONS } from "@/lib/mcp/card";

/**
 * The Remedy MCP server: Model Context Protocol over Streamable HTTP, stateless, answering each JSON-RPC request with
 * a JSON response. Add it to an agent with: claude mcp add --transport http remedy https://<host>/api/mcp
 */
const VERSIONS = SUPPORTED_VERSIONS;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Accept",
};

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const reply = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result });
const error = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } });

const schemaOf = (s: z.ZodType) => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io: "input" }) as Record<string, unknown>;
  void _drop;
  return rest;
};

const origin = publicOrigin;

async function handle(msg: Rpc, req: Request) {
  const id = msg.id;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return reply(id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.changes ? `${t.description} Changes: ${t.changes}` : t.description, inputSchema: schemaOf(t.input), annotations: { title: t.title, ...t.annotations } })),
      });
    case "tools/call": {
      const t = TOOLS.find((x) => x.name === msg.params?.name);
      if (!t) return error(id, -32602, `Unknown tool: ${String(msg.params?.name)}`);
      const parsed = t.input.safeParse(msg.params?.arguments ?? {});
      if (!parsed.success) {
        return reply(id, { content: [{ type: "text", text: `Those arguments do not fit ${t.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}` }], isError: true });
      }
      try {
        // Each tool's input type is checked by its own schema above.
        const run = t.run as (i: unknown, c: Ctx) => Promise<ToolResult>;
        const r = await run(parsed.data, { origin: origin(req), keyId: await keyIdFor(req), auth: req.headers.get("authorization") });
        return reply(id, { content: [{ type: "text", text: r.text }], ...(r.data ? { structuredContent: r.data } : {}), isError: Boolean(r.isError) });
      } catch (e) {
        log.error("mcp tool failed", { tool: t.name, error: e });
        return reply(id, { content: [{ type: "text", text: "Remedy could not complete that just now. Please try again." }], isError: true });
      }
    }
    default:
      return error(id, -32601, `Method not found: ${msg.method}`);
  }
}

async function post(req: Request) {
  const body = (await req.json().catch(() => null)) as Rpc | Rpc[] | null;
  if (!body) return Response.json(error(null, -32700, "Parse error"), { status: 400, headers: CORS });
  const batch = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of batch) {
    if (m?.jsonrpc !== "2.0" || typeof m.method !== "string") {
      out.push(error(m?.id, -32600, "Invalid request"));
      continue;
    }
    if (m.id === undefined) continue; // a notification, such as notifications/initialized: nothing to answer
    out.push(await handle(m, req));
  }
  if (out.length === 0) return new Response(null, { status: 202, headers: CORS });
  return Response.json(Array.isArray(body) ? out : out[0], { headers: CORS });
}

export const POST = (req: Request) => guard(req, "mcp", () => post(req));

/** This server does not open a server-to-client event stream. */
export function GET() {
  return new Response("Remedy MCP server. Send JSON-RPC requests with POST.", { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
