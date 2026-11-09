/**
 * The firm console's live feed (Server-Sent Events). Two sources, so it works on one server and across processes:
 * - payment events from this process (onPaymentEvent: the webhook route, a poll, a pay call) are pushed at once;
 * - plan_task and payment rows are read every 1.5 seconds, so a row written by another process (a webhook on another
 *   instance, scripts/payments/seed-event.ts) still reaches the page without a reload.
 * While a payout is on its way, the feed also asks PayPal for its status every few seconds (refreshPayment), since
 * in the sandbox an item reaches SUCCESS in about 17 seconds and the webhook can take longer. Server only.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { describeStatus, onPaymentEvent, refreshPayment, type PaymentEvent } from "@/lib/payments";
import type { PaymentStatus } from "@/lib/payments/types";
import { isoDay } from "./dates";
import type { Firm } from "./firm";
import { groupFor, taskFor, type GanttDependency } from "./plan";
import { lastTaskId, planRows } from "./plan-data";
import { payFromDb } from "./queue";
import { notTest } from "./origin";

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

declare global {
  var __remedyFirmRefreshAt: number | undefined;
}

export function liveStream(firm: Firm, recallNumber: string, signal: AbortSignal) {
  let lastTask = 0;
  let lastPay = new Date();
  let closed = false;
  const timers: ReturnType<typeof setInterval>[] = [];
  let unsubscribe: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(frame(event, data));
        } catch {
          close();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        timers.forEach(clearInterval);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener("abort", close, { once: true });

      lastTask = await lastTaskId(firm.id);
      send("ready", { at: new Date().toISOString(), lastTask });

      let busy = false;
      const poll = async () => {
        if (busy || closed) return;
        busy = true;
        try {
          const rows = await planRows(firm, recallNumber, lastTask);
          const today = isoDay(new Date());
          for (const r of rows) {
            lastTask = Math.max(lastTask, r.id);
            const deps: GanttDependency[] = (r.dependencies ?? []).map((d) => ({ id: `d${d.from}-${r.id}`, fromTask: d.from, toTask: r.id, type: d.type ?? 2 }));
            send("task", { task: taskFor(r, today), groupId: groupFor(r.kind), dependencies: deps, source: r.source, kind: r.kind });
          }
          const changed = (
            await db().execute(sql`
            select p.claim_id, p.status, p.route, p.updated_at, p.paypal_status from payment p join claim c on c.id = p.claim_id
            where c.firm_id = ${firm.id} and ${notTest()} and p.updated_at > ${lastPay} order by p.updated_at`)
          ).rows as { claim_id: string; status: string; route: string; updated_at: Date; paypal_status: string | null }[];
          for (const p of changed) {
            lastPay = new Date(Math.max(lastPay.getTime(), new Date(p.updated_at).getTime()));
            const s = payFromDb(p.status, p.route) as PaymentStatus;
            send("payment", { claimId: p.claim_id, status: s, label: describeStatus(s, p.route as "payout").label, paypalStatus: p.paypal_status });
          }
        } catch {
          /* the next tick tries again */
        } finally {
          busy = false;
        }
      };

      const refresh = async () => {
        // One PayPal status check across every open page, at most every 6 seconds.
        const now = Date.now();
        if (closed || (globalThis.__remedyFirmRefreshAt ?? 0) > now - 6000) return;
        globalThis.__remedyFirmRefreshAt = now;
        try {
          const open = (
            await db().execute(sql`
            select distinct on (p.paypal_batch_id) p.claim_id from payment p join claim c on c.id = p.claim_id
            where c.firm_id = ${firm.id} and p.status = 'pending' and p.paypal_batch_id is not null and p.created_at > now() - interval '3 hours'
            limit 5`)
          ).rows as { claim_id: string }[];
          for (const o of open) await refreshPayment(o.claim_id);
        } catch {
          /* PayPal unreachable: the webhook still lands later */
        }
      };

      unsubscribe = onPaymentEvent((e: PaymentEvent) => {
        if (e.payment.firmId && e.payment.firmId !== String(firm.id)) return;
        send("payment", { claimId: e.payment.claimId, status: e.payment.status, label: describeStatus(e.payment.status, e.payment.route).label, plain: e.plain, source: e.source });
        void poll();
      });
      timers.push(setInterval(() => void poll(), 1500));
      timers.push(setInterval(() => void refresh(), 3000));
      timers.push(setInterval(() => send("ping", { at: new Date().toISOString() }), 15000));
    },
    cancel() {
      closed = true;
      timers.forEach(clearInterval);
      unsubscribe?.();
    },
  });
}
