import { describe, expect, it } from "vitest";
import { memoryLedger, type PaymentsDeps } from "@/lib/payments/deps";
import { FakePayPal } from "@/lib/payments/fake-paypal";
import { hasPriorRefund } from "@/lib/payments/refunds";
import { MemoryStore } from "@/lib/payments/store";
import { PAYPAL_READ_TOOLS, PayPalMcp, readOrderViaMcp } from "@/lib/paypal/mcp";

/**
 * Check C6 reads the purchase's order through PayPal's own MCP server (get_order, read only), with the Orders API as
 * the fallback. Everything here is mocked: a fake MCP server over server-sent events and FakePayPal for REST.
 */

/** A fake PayPal MCP server: GET /sse sends the endpoint, and each POSTed request is answered on the stream. */
function fakeMcpServer(answer: (method: string, params: Record<string, unknown>) => unknown) {
  const enc = new TextEncoder();
  let push: ((s: string) => void) | null = null;
  const posted: { method?: string; params?: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/sse")) {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (s) => c.enqueue(enc.encode(s));
          push("event: endpoint\ndata: /messages?session=s1\n\n");
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    const msg = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string; params?: Record<string, unknown> };
    posted.push({ method: msg.method, params: msg.params });
    if (msg.id !== undefined) queueMicrotask(() => push?.(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: answer(msg.method ?? "", msg.params ?? {}) })}\n\n`));
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  return { f, posted };
}

const ORDER = (captureId: string, refunds: { id: string; status: string; value: string }[] = [], captureStatus = "COMPLETED") => ({
  id: "ORD-1",
  status: "COMPLETED",
  purchase_units: [{ payments: { captures: [{ id: captureId, status: captureStatus }], refunds: refunds.map((r) => ({ id: r.id, status: r.status, amount: { value: r.value }, links: [{ rel: "up", href: `https://api/v2/payments/captures/${captureId}` }] })) } }],
});

function setup() {
  const pp = new FakePayPal();
  const deps: Partial<PaymentsDeps> = { store: new MemoryStore(), ledger: memoryLedger().ledger, rest: pp.rest, now: () => new Date("2026-11-05T18:00:00Z") };
  return { pp, deps };
}

describe("PayPal's MCP server, read only", () => {
  it("opens a session over server-sent events and reads an order with get_order", async () => {
    const { f, posted } = fakeMcpServer((method, params) =>
      method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify({ ...ORDER("CAP-1"), asked: params.arguments }) }] } : { protocolVersion: "2024-11-05", capabilities: {} },
    );
    const r = await readOrderViaMcp("ORD-1", { connect: () => PayPalMcp.connect({ token: "t", base: "https://mcp.test", fetch: f }) });
    expect(r.via).toBe("mcp");
    expect(r.via === "mcp" && r.body.id).toBe("ORD-1");
    expect(posted.map((p) => p.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(posted[2].params).toMatchObject({ name: "get_order", arguments: { id: "ORD-1" } });
  });

  it("refuses any tool that is not a read tool, before anything is sent", async () => {
    const { f, posted } = fakeMcpServer(() => ({}));
    const mcp = await PayPalMcp.connect({ token: "t", base: "https://mcp.test", fetch: f });
    const before = posted.length;
    await expect(mcp.call("create_refund", { capture_id: "CAP-1" })).rejects.toThrow(/not a read tool/);
    expect(posted.length).toBe(before);
    expect([...PAYPAL_READ_TOOLS]).toEqual(["get_order"]);
    mcp.close();
  });

  it("answers null with the reason when the server errors or cannot be reached, so the caller reads REST", async () => {
    const err = await readOrderViaMcp("ORD-1", { connect: async () => ({ call: async () => ({ isError: true, content: [{ type: "text", text: '{"ok":false,"code":"PAYPAL_API_SETUP_ERROR"}' }] }), close: () => {} }) });
    expect(err).toEqual({ via: null, why: "get_order answered PAYPAL_API_SETUP_ERROR" });
    const down = await readOrderViaMcp("ORD-1", { connect: async () => Promise.reject(new Error("fetch failed")) });
    expect(down).toEqual({ via: null, why: "not reached (fetch failed)" });
  });
});

describe("check C6 through PayPal's MCP server", () => {
  it("reads the order's refunds from get_order and does not call the Orders API", async () => {
    const { pp, deps } = setup();
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: "2026-11-01T12:00:00Z" });
    const r = await hasPriorRefund(captureId, { ...deps, orderViaMcp: async () => ({ via: "mcp", body: ORDER(captureId, [{ id: "R-1", status: "COMPLETED", value: "34.99" }]) }) });
    expect(r).toMatchObject({ refunded: true, fullyRefunded: true, pass: false, orderSource: { via: "mcp", note: null } });
    expect(r.calls).toContain(`PayPal MCP get_order ${r.orderId}`);
    expect(pp.count("GET", "/v2/checkout/orders/")).toBe(0);
    expect(r.technical).toContain("through PayPal's MCP server (get_order)");
  });

  it("passes a clean purchase read through the MCP server", async () => {
    const { pp, deps } = setup();
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: "2026-11-01T12:00:00Z" });
    const r = await hasPriorRefund(captureId, { ...deps, orderViaMcp: async () => ({ via: "mcp", body: ORDER(captureId) }) });
    expect(r).toMatchObject({ refunded: false, pass: true, orderSource: { via: "mcp" } });
  });

  it("falls back to the Orders API when the MCP server cannot answer, and says so", async () => {
    const { pp, deps } = setup();
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: "2026-11-01T12:00:00Z" });
    const r = await hasPriorRefund(captureId, { ...deps, orderViaMcp: async () => ({ via: null, why: "not reached (timed out)" }) });
    expect(r).toMatchObject({ pass: true, orderSource: { via: "rest", note: "PayPal's MCP server not reached (timed out), so the Orders API was read instead" } });
    expect(pp.count("GET", "/v2/checkout/orders/")).toBe(1);
    const thrown = await hasPriorRefund(captureId, { ...deps, orderViaMcp: async () => Promise.reject(new Error("boom")) });
    expect(thrown.orderSource.via).toBe("rest");
  });

  it("does not pass when PayPal's two answers disagree on the capture's state", async () => {
    const { pp, deps } = setup();
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: "2026-11-01T12:00:00Z" });
    const r = await hasPriorRefund(captureId, { ...deps, orderViaMcp: async () => ({ via: "mcp", body: ORDER(captureId, [], "PENDING") }) });
    expect(r.pass).toBe(false);
    expect(r.orderSource.note).toBe("PayPal's MCP server lists the capture as PENDING, the Payments API as COMPLETED");
  });

  it("without the MCP reader (tests, or PAYPAL_MCP=off), C6 reads the Orders API as before", async () => {
    const { pp, deps } = setup();
    const { captureId } = pp.addCapture({ amount: "34.99", createTime: "2026-11-01T12:00:00Z" });
    const r = await hasPriorRefund(captureId, deps);
    expect(r.orderSource).toEqual({ via: "rest", note: null });
  });
});
