/**
 * One read-only check that check C6 can read an order through PayPal's own MCP server: find a recent sandbox capture
 * (Transaction Search, or the capture id given), read its order with the server's get_order tool, and run C6 on it
 * (hasPriorRefund), which says where the order was read. Every call here is a read; nothing is paid or refunded.
 * Writes content/public/paypal-mcp-read.json for /stack.
 *
 *   ANTHROPIC_API_KEY= npx tsx --env-file=.env.local scripts/payments/mcp-probe.ts [captureId]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { paypalRest } from "../../src/lib/paypal/client";
import { PayPalMcp, paypalMcpBase, readOrderViaMcp } from "../../src/lib/paypal/mcp";
import { getCapture, hasPriorRefund } from "../../src/lib/payments/refunds";
import { MemoryStore } from "../../src/lib/payments/store";
import { memoryLedger } from "../../src/lib/payments/deps";
import { sdkRest } from "../../src/lib/paypal/sdk-rest";
import type { Rest } from "../../src/lib/payments/types";

async function recentCapture(): Promise<string | null> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const q = new URLSearchParams({ start_date: start.toISOString().replace(/\.\d+Z$/, "Z"), end_date: end.toISOString().replace(/\.\d+Z$/, "Z"), transaction_status: "S", fields: "transaction_info", page_size: "100" });
  const r = await paypalRest<{ transaction_details?: { transaction_info?: { transaction_id?: string; transaction_event_code?: string } }[] }>(`/v1/reporting/transactions?${q}`, { method: "GET" });
  // T0006: a PayPal Checkout payment, the kind an order captures.
  return r.body.transaction_details?.map((t) => t.transaction_info).find((t) => t?.transaction_event_code === "T0006")?.transaction_id ?? null;
}

async function main() {
  const captureId = process.argv[2] ?? (await recentCapture());
  if (!captureId) throw new Error("No recent sandbox capture found; pass a capture id.");
  const cap = await getCapture(captureId, { store: new MemoryStore(), ledger: memoryLedger().ledger, rest: sdkRest as Rest });
  if (!cap.ok || !cap.capture.orderId) throw new Error(`Capture lookup: ${cap.ok ? "no order id" : cap.status}`);
  const t0 = Date.now();
  const mcp = await readOrderViaMcp(cap.capture.orderId);
  const mcpMs = Date.now() - t0;
  const tools = await PayPalMcp.connect()
    .then(async (c) => {
      c.close();
      return true;
    })
    .catch(() => false);
  const c6 = await hasPriorRefund(captureId, { store: new MemoryStore(), ledger: memoryLedger().ledger, rest: sdkRest as Rest, orderViaMcp: (id) => readOrderViaMcp(id) });
  const out = {
    note: "Written by scripts/payments/mcp-probe.ts: one read-only check of check C6 reading a sandbox order through PayPal's MCP server (get_order). Nothing was paid or refunded.",
    readAt: new Date().toISOString(),
    server: paypalMcpBase(),
    sessionOpened: tools,
    getOrder: mcp.via === "mcp" ? { ok: true, ms: mcpMs, status: mcp.body.status ?? null } : { ok: false, ms: mcpMs, why: mcp.why },
    c6: { pass: c6.pass, orderSource: c6.orderSource, calls: c6.calls.map((x) => x.replace(/[A-Z0-9]{12,}/g, (id) => `${id.slice(0, 4)}…`)) },
  };
  writeFileSync(path.join(process.cwd(), "content", "public", "paypal-mcp-read.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
