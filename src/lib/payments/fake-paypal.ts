import type { Rest } from "./types";

/**
 * A small offline stand-in for the PayPal REST endpoints the payments engine uses, for unit tests (no network).
 * It honors PayPal-Request-Id (same id, same answer), keeps batches, items, captures, refunds, orders, disputes and
 * webhook events in memory, and records every call so a test can count them. Behavior follows what the sandbox did
 * on Nov 5, 2026: EMAIL and PHONE items succeed, an unregistered email is UNCLAIMED, the Venmo wallet is refused.
 */
export type FakeCall = { method: string; path: string; requestId?: string; headers: Record<string, string>; body: unknown };
type Resp = { status: number; body: unknown };

type Item = { payout_item_id: string; transaction_id: string; transaction_status: string; payout_batch_id: string; payout_item: Record<string, unknown>; errors?: { name: string } };
type Capture = { id: string; status: string; amount: string; create_time: string; orderId: string; custom_id?: string };
type Refund = { id: string; status: string; amount: string; captureId: string };

export class FakePayPal {
  calls: FakeCall[] = [];
  private idem = new Map<string, Resp>();
  private n = 0;
  batches = new Map<string, { header: Record<string, unknown>; items: Item[] }>();
  items = new Map<string, Item>();
  captures = new Map<string, Capture>();
  refunds = new Map<string, Refund>();
  orders = new Map<string, Record<string, unknown>>();
  disputes = new Map<string, { dispute_id: string; status: string }[]>();
  disputesStatus = 200;
  events = new Map<string, Record<string, unknown>>();
  transactions: Record<string, unknown>[] = [];
  /** Sandbox behavior: the Venmo wallet is refused. */
  venmoSupported = false;
  /** Return a response here to override the next matching call (for 5xx and refusals). */
  override: ((c: FakeCall) => Resp | undefined) | null = null;
  /** Do the work of the next call to this path, then answer 503 as if the response was lost on the way back. */
  loseResponseTo: string | null = null;

  private id(prefix: string) {
    this.n++;
    return `${prefix}${String(this.n).padStart(10, "0")}`.toUpperCase();
  }

  count(method: string, pathPrefix: string) {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(pathPrefix)).length;
  }

  /** Add a completed capture (and its order), as if a buyer paid the firm. */
  addCapture(o: { id?: string; amount: string; createTime: string; status?: string; customId?: string; payerEmail?: string; reference?: string; itemName?: string }) {
    const id = o.id ?? this.id("CAP");
    const orderId = this.id("ORD");
    this.captures.set(id, { id, status: o.status ?? "COMPLETED", amount: o.amount, create_time: o.createTime, orderId, custom_id: o.customId });
    this.orders.set(orderId, {
      id: orderId,
      status: "COMPLETED",
      payment_source: o.payerEmail ? { paypal: { email_address: o.payerEmail, name: { given_name: "Jordan" } } } : undefined,
      purchase_units: [{ reference_id: o.reference ?? "default", custom_id: o.customId, items: [{ name: o.itemName ?? "Item", sku: "SKU", quantity: "1" }], payments: { captures: [{ id, status: "COMPLETED", amount: { value: o.amount }, create_time: o.createTime }] } }],
    });
    return { captureId: id, orderId };
  }

  /** Add an APPROVED (not yet captured) order. */
  addApprovedOrder(o: { reference: string; customId?: string; amount: string; payerEmail?: string; itemName?: string; sku?: string }) {
    const id = this.id("ORD");
    this.orders.set(id, {
      id,
      status: "APPROVED",
      payment_source: o.payerEmail ? { paypal: { email_address: o.payerEmail, name: { given_name: "Jordan" } } } : undefined,
      purchase_units: [{ reference_id: o.reference, custom_id: o.customId, amount: { value: o.amount }, items: [{ name: o.itemName ?? "Item", sku: o.sku ?? "SKU", quantity: "1" }] }],
    });
    return id;
  }

  /** Move an item to a new PayPal status and record the webhook event PayPal would send. */
  setItemStatus(itemId: string, status: string, eventType: string) {
    const it = this.items.get(itemId)!;
    it.transaction_status = status;
    const ev = { id: `WH-${this.id("EVT")}-${this.id("X")}`, event_type: eventType, resource_type: "payouts_item", resource: { ...it } };
    this.events.set(ev.id, ev);
    return ev;
  }

  rest: Rest = async <T>(path: string, init: RequestInit & { requestId?: string } = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const call: FakeCall = { method, path, requestId: init.requestId, headers, body };
    this.calls.push(call);
    const forced = this.override?.(call);
    if (forced) return { status: forced.status, body: forced.body as T, debugId: "fake-debug" };
    // PayPal-Request-Id replays the first answer, except on Payouts create, which answers a repeat with a refusal.
    const key = init.requestId && path !== "/v1/payments/payouts" ? `${method} ${path.split("?")[0]} ${init.requestId}` : null;
    if (key && this.idem.has(key)) {
      const r = this.idem.get(key)!;
      return { status: r.status, body: r.body as T, debugId: "fake-debug" };
    }
    const r = this.route(call);
    if (key && r.status < 500) this.idem.set(key, r);
    if (this.loseResponseTo === path) {
      this.loseResponseTo = null;
      return { status: 503, body: { name: "SERVICE_UNAVAILABLE" } as T, debugId: "fake-debug" };
    }
    return { status: r.status, body: r.body as T, debugId: "fake-debug" };
  };

  private route(c: FakeCall): Resp {
    const [p, qs] = c.path.split("?");
    const q = new URLSearchParams(qs ?? "");
    let m: RegExpMatchArray | null;

    if (c.method === "POST" && p === "/v1/payments/payouts") {
      const b = c.body as { sender_batch_header: { sender_batch_id: string }; items: Record<string, unknown>[] };
      // Real PayPal refuses a repeated sender_batch_id (even with the same PayPal-Request-Id) and links the first batch.
      const dup = [...this.batches.values()].find((x) => (x.header.sender_batch_header as { sender_batch_id: string }).sender_batch_id === b.sender_batch_header.sender_batch_id);
      if (dup)
        return {
          status: 400,
          body: {
            name: "USER_BUSINESS_ERROR",
            message: "User business error.",
            details: [{ field: "SENDER_BATCH_ID", location: "body", issue: "Batch with given sender_batch_id already exists", link: [{ href: `https://api.sandbox.paypal.com/v1/payments/payouts/${dup.header.payout_batch_id}`, rel: "self", method: "GET" }] }],
          },
        };
      if (!this.venmoSupported && b.items.some((i) => i.recipient_wallet))
        return { status: 400, body: { name: "VALIDATION_ERROR", details: [{ field: "items[0].recipient_wallet", location: "body", issue: "Recipient wallet not supported in sandbox." }] } };
      const batchId = this.id("B");
      const header = { payout_batch_id: batchId, batch_status: "PENDING", sender_batch_header: b.sender_batch_header };
      const items: Item[] = b.items.map((i) => {
        const unregistered = String(i.receiver).includes("unregistered");
        const it: Item = {
          payout_item_id: this.id("I"),
          transaction_id: this.id("T"),
          transaction_status: unregistered ? "UNCLAIMED" : "SUCCESS",
          payout_batch_id: batchId,
          payout_item: { ...i },
          ...(unregistered ? { errors: { name: "RECEIVER_UNREGISTERED" } } : {}),
        };
        this.items.set(it.payout_item_id, it);
        return it;
      });
      this.batches.set(batchId, { header, items });
      return { status: 201, body: { batch_header: header, links: [] } };
    }
    if (c.method === "GET" && (m = p.match(/^\/v1\/payments\/payouts\/([A-Z0-9]+)$/))) {
      const b = this.batches.get(m[1]);
      if (!b) return { status: 404, body: { name: "INVALID_RESOURCE_ID" } };
      return { status: 200, body: { batch_header: { ...b.header, batch_status: "SUCCESS" }, items: b.items.map((i) => ({ ...i })), total_page: 1 } };
    }
    if (c.method === "GET" && (m = p.match(/^\/v1\/payments\/payouts-item\/([A-Z0-9]+)$/))) {
      const it = this.items.get(m[1]);
      return it ? { status: 200, body: { ...it } } : { status: 404, body: { name: "INVALID_RESOURCE_ID" } };
    }
    if (c.method === "POST" && (m = p.match(/^\/v1\/payments\/payouts-item\/([A-Z0-9]+)\/cancel$/))) {
      const it = this.items.get(m[1]);
      if (!it) return { status: 404, body: { name: "INVALID_RESOURCE_ID" } };
      if (it.transaction_status !== "UNCLAIMED") return { status: 400, body: { name: "ITEM_INCORRECT_STATUS", message: "Only items in Unclaimed status cancelled." } };
      it.transaction_status = "RETURNED";
      return { status: 200, body: { ...it } };
    }
    if (c.method === "GET" && (m = p.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)$/))) {
      const cap = this.captures.get(m[1]);
      if (!cap) return { status: 404, body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } };
      return {
        status: 200,
        body: { id: cap.id, status: cap.status, amount: { value: cap.amount, currency_code: "USD" }, create_time: cap.create_time, custom_id: cap.custom_id, supplementary_data: { related_ids: { order_id: cap.orderId } } },
      };
    }
    if (c.method === "POST" && (m = p.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)\/refund$/))) {
      const cap = this.captures.get(m[1]);
      if (!cap) return { status: 404, body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } };
      if (cap.status === "REFUNDED") return { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "CAPTURE_FULLY_REFUNDED" }] } };
      const amount = (c.body as { amount: { value: string } }).amount.value;
      const done = [...this.refunds.values()].filter((r) => r.captureId === cap.id).reduce((s, r) => s + Number(r.amount), 0);
      if (done + Number(amount) > Number(cap.amount) + 1e-9) return { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "REFUND_AMOUNT_EXCEEDED" }] } };
      const id = this.id("R");
      this.refunds.set(id, { id, status: "COMPLETED", amount, captureId: cap.id });
      cap.status = done + Number(amount) >= Number(cap.amount) - 1e-9 ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const order = this.orders.get(cap.orderId) as { purchase_units: { payments: { refunds?: unknown[] } }[] } | undefined;
      if (order) {
        const pay = order.purchase_units[0].payments;
        pay.refunds = [...(pay.refunds ?? []), { id, status: "COMPLETED", amount: { value: amount }, links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${cap.id}` }] }];
      }
      return { status: 201, body: { id, status: "COMPLETED" } };
    }
    if (c.method === "GET" && (m = p.match(/^\/v2\/payments\/refunds\/([A-Z0-9]+)$/))) {
      const r = this.refunds.get(m[1]);
      return r ? { status: 200, body: { id: r.id, status: r.status, amount: { value: r.amount } } } : { status: 404, body: { name: "RESOURCE_NOT_FOUND" } };
    }
    if (c.method === "POST" && p === "/v2/checkout/orders") {
      const id = this.id("ORD");
      const b = c.body as { purchase_units: Record<string, unknown>[]; payment_source?: { card?: unknown } };
      if (b.payment_source?.card) {
        const capId = this.id("CAP");
        const value = (b.purchase_units[0].amount as { value: string }).value;
        const order = { id, status: "COMPLETED", purchase_units: [{ ...b.purchase_units[0], payments: { captures: [{ id: capId, status: "COMPLETED", amount: { value } }] } }] };
        this.orders.set(id, order);
        return { status: 201, body: order };
      }
      const order = { id, status: "PAYER_ACTION_REQUIRED", purchase_units: b.purchase_units, links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
      this.orders.set(id, order);
      return { status: 200, body: order };
    }
    if (c.method === "GET" && (m = p.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)$/))) {
      const o = this.orders.get(m[1]);
      return o ? { status: 200, body: structuredClone(o) } : { status: 404, body: { name: "RESOURCE_NOT_FOUND" } };
    }
    if (c.method === "POST" && (m = p.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)\/capture$/))) {
      const o = this.orders.get(m[1]) as { id: string; status: string; purchase_units: { amount?: { value: string }; payments?: unknown; custom_id?: string }[] } | undefined;
      if (!o) return { status: 404, body: { name: "RESOURCE_NOT_FOUND" } };
      if (o.status === "COMPLETED") return { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] } };
      if (o.status !== "APPROVED") return { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] } };
      const capId = this.id("CAP");
      const value = o.purchase_units[0].amount?.value ?? "0.00";
      const at = new Date().toISOString();
      o.status = "COMPLETED";
      o.purchase_units[0].payments = { captures: [{ id: capId, status: "COMPLETED", amount: { value }, create_time: at }] };
      this.captures.set(capId, { id: capId, status: "COMPLETED", amount: value, create_time: at, orderId: o.id, custom_id: o.purchase_units[0].custom_id });
      return { status: 201, body: structuredClone(o) };
    }
    if (c.method === "GET" && p === "/v1/customer/disputes") {
      if (this.disputesStatus !== 200) return { status: this.disputesStatus, body: { name: "NOT_AUTHORIZED" } };
      return { status: 200, body: { items: this.disputes.get(q.get("disputed_transaction_id") ?? "") ?? [] } };
    }
    if (c.method === "GET" && (m = p.match(/^\/v1\/notifications\/webhooks-events\/(.+)$/))) {
      const e = this.events.get(decodeURIComponent(m[1]));
      return e ? { status: 200, body: structuredClone(e) } : { status: 404, body: { name: "INVALID_RESOURCE_ID" } };
    }
    if (c.method === "POST" && p === "/v1/notifications/verify-webhook-signature") {
      return { status: 200, body: { verification_status: (c.body as { transmission_sig?: string }).transmission_sig === "good-signature" ? "SUCCESS" : "FAILURE" } };
    }
    if (c.method === "GET" && p === "/v1/reporting/transactions") {
      const s = Date.parse(q.get("start_date") ?? "");
      const e = Date.parse(q.get("end_date") ?? "");
      if (e - s > 31 * 86_400_000 + 1000) return { status: 400, body: { name: "INVALID_REQUEST", message: "Date range is greater than 31 days" } };
      const inWindow = this.transactions.filter((t) => {
        const at = Date.parse((t.transaction_info as { transaction_initiation_date: string }).transaction_initiation_date);
        return at >= s && at <= e;
      });
      return { status: 200, body: { transaction_details: inWindow, total_pages: 1, total_items: inWindow.length } };
    }
    return { status: 404, body: { name: "NOT_FOUND_IN_FAKE", message: `${c.method} ${p}` } };
  }
}
