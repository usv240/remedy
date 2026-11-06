import { connection } from "next/server";
import { fail } from "@/lib/api/envelope";
import { withRequest } from "@/lib/log";
import { feed, type FeedItem } from "@/lib/ops/data";
import { clientIp, clientKey, hit } from "@/lib/ratelimit";

/**
 * GET /api/ops/live: the public event feed for /ops, the newest ledger entries and API requests as one list, masked.
 * Server-Sent Events by default ("items" every 2 seconds with what is new, "ping" every 15 s); `?once=1` answers
 * once with JSON for reduced-motion readers and the Refresh button. Nothing private: ids are shortened, no payees.
 */
export async function GET(req: Request) {
  await connection();
  return withRequest(req, "GET /api/ops/live", async () => {
    const limit = await hit(`ops-live:${clientKey(clientIp(req))}`, 60, 60_000);
    if (!limit.ok) return fail("rate_limited", "Too many requests this minute. Please wait a moment and try again.", 429);
    const once = new URL(req.url).searchParams.get("once") === "1";
    if (once) return Response.json({ items: await feed(), at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });

    const enc = new TextEncoder();
    let closed = false;
    const timers: ReturnType<typeof setInterval>[] = [];
    const after = { ledger: 0, request: 0 };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            close();
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          timers.forEach(clearInterval);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        req.signal.addEventListener("abort", close, { once: true });
        const note = (items: FeedItem[]) => {
          for (const i of items) {
            if (i.kind === "ledger") after.ledger = Math.max(after.ledger, i.id);
            else after.request = Math.max(after.request, i.id);
          }
        };
        const first = await feed();
        note(first);
        send("items", { items: first, at: new Date().toISOString() });
        let busy = false;
        timers.push(
          setInterval(async () => {
            if (busy || closed) return;
            busy = true;
            try {
              const items = await feed(after, 50);
              if (items.length) {
                note(items);
                send("items", { items, at: new Date().toISOString() });
              }
            } catch {
              /* the next tick tries again */
            } finally {
              busy = false;
            }
          }, 2000),
        );
        timers.push(setInterval(() => send("ping", { at: new Date().toISOString() }), 15_000));
        // A feed is a window, not a connection to keep for ever: it ends after ten minutes and the page reconnects.
        setTimeout(close, 10 * 60_000);
      },
      cancel() {
        closed = true;
        timers.forEach(clearInterval);
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  });
}
