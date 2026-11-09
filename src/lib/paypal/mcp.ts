/**
 * PayPal's own MCP server, read only: check C6 ("not already refunded") reads the purchase's order, with its captures
 * and refunds, through the server's get_order tool, and falls back to the Orders API when the server cannot be reached
 * or cannot answer (src/lib/payments/refunds.ts). Only read tools can be called (PAYPAL_READ_TOOLS); anything that
 * moves money stays in Remedy's own code, the payment router.
 *
 * PayPal's hosted server speaks MCP over HTTP and server-sent events: GET {base}/sse opens a stream whose first
 * "endpoint" event names a URL; JSON-RPC requests are POSTed there with the same bearer token, and the answers arrive on
 * the stream, matched by id. The server is PayPal's sandbox or live one, as PAYPAL_ENV says (src/lib/paypal/env.ts);
 * PAYPAL_MCP=off switches it off; PAYPAL_MCP_URL names another server. Server only.
 */
import { accessToken, paypalConfigured } from "./client";
import { paypalMcpDefault } from "./env";

export const paypalMcpBase = () => process.env.PAYPAL_MCP_URL?.trim() || paypalMcpDefault();
/** The only tools Remedy calls on PayPal's server. Reading an order changes nothing. */
export const PAYPAL_READ_TOOLS: ReadonlySet<string> = new Set(["get_order"]);
export const paypalMcpEnabled = () => paypalConfigured() && process.env.PAYPAL_MCP?.trim().toLowerCase() !== "off";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
export type McpCallResult = { content: { type: string; text?: string }[]; isError?: boolean };
type Fetch = typeof fetch;

export class PayPalMcp {
  private postUrl: string | null = null;
  private pending = new Map<number, Pending>();
  private id = 0;
  private abort = new AbortController();

  private constructor(
    private token: string,
    private base: string,
    private f: Fetch,
  ) {}

  /** Open a session: the event stream, then initialize. */
  static async connect(o: { token?: string; base?: string; fetch?: Fetch; timeoutMs?: number } = {}) {
    const c = new PayPalMcp(o.token ?? (await accessToken()), o.base ?? paypalMcpBase(), o.fetch ?? fetch);
    try {
      await c.open(o.timeoutMs ?? 6000);
      await c.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "remedy-c6", version: "1" } }, o.timeoutMs ?? 6000);
      await c.post({ jsonrpc: "2.0", method: "notifications/initialized" });
      return c;
    } catch (e) {
      c.close();
      throw e;
    }
  }

  private async open(timeoutMs: number) {
    const timer = setTimeout(() => this.abort.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.f(`${this.base}/sse`, { headers: { accept: "text/event-stream", authorization: `Bearer ${this.token}` }, signal: this.abort.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !res.body) throw new Error(`PayPal MCP server answered ${res.status}`);
    const reader = res.body.getReader();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("PayPal MCP server sent no endpoint")), timeoutMs);
      void this.pump(reader, () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** Read the event stream: the endpoint event once, then JSON-RPC answers. */
  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>, onEndpoint: () => void) {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let cut: number;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const event = /^event: ?(.*)$/m.exec(raw)?.[1]?.trim() ?? "message";
          const data = raw
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n");
          if (event === "endpoint") {
            this.postUrl = new URL(data, this.base).toString();
            onEndpoint();
          } else if (data) {
            let msg: { id?: number; result?: unknown; error?: { message?: string } };
            try {
              msg = JSON.parse(data);
            } catch {
              continue;
            }
            const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
            if (p) {
              this.pending.delete(msg.id!);
              if (msg.error) p.reject(new Error(msg.error.message ?? "PayPal MCP error"));
              else p.resolve(msg.result);
            }
          }
        }
      }
    } catch (e) {
      if (!this.abort.signal.aborted) for (const p of this.pending.values()) p.reject(e as Error);
    }
  }

  private async post(body: unknown) {
    if (!this.postUrl) throw new Error("PayPal MCP session is not open");
    const r = await this.f(this.postUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` }, body: JSON.stringify(body) });
    if (!r.ok && r.status !== 202) throw new Error(`PayPal MCP server answered ${r.status}`);
  }

  private request<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
    const id = ++this.id;
    const answer = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`PayPal MCP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
    return this.post({ jsonrpc: "2.0", id, method, params }).then(() => answer);
  }

  /** Call a read tool. Any tool outside PAYPAL_READ_TOOLS is refused here, before anything is sent. */
  async call(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpCallResult> {
    if (!PAYPAL_READ_TOOLS.has(name)) throw new Error(`${name} is not a read tool`);
    return this.request<McpCallResult>("tools/call", { name, arguments: args }, timeoutMs);
  }

  close() {
    this.abort.abort();
  }
}

export type McpOrder = { via: "mcp"; body: Record<string, unknown> };

/**
 * Read one order through PayPal's MCP server (get_order). Null when the server is off, cannot be reached, or answers
 * with an error; the caller then reads the Orders API instead, and `why` says which.
 */
export async function readOrderViaMcp(orderId: string, o: { connect?: () => Promise<Pick<PayPalMcp, "call" | "close">> } = {}): Promise<McpOrder | { via: null; why: string }> {
  let mcp: Pick<PayPalMcp, "call" | "close"> | null = null;
  try {
    mcp = await (o.connect ?? (() => PayPalMcp.connect()))();
    const r = await mcp.call("get_order", { id: orderId });
    const text = r.content.map((c) => c.text ?? "").join("");
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
    if (r.isError || !body || body.ok === false || typeof body.id !== "string") return { via: null, why: `get_order answered ${typeof body?.code === "string" ? body.code : "an error"}` };
    return { via: "mcp", body };
  } catch (e) {
    return { via: null, why: `not reached (${(e as Error).message.replace(/Bearer\s+\S+/g, "Bearer ***").slice(0, 120)})` };
  } finally {
    mcp?.close();
  }
}
