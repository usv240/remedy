import { ctxOr } from "@/lib/firm/api";
import { liveStream } from "@/lib/firm/live";

/**
 * GET /api/firm/live: Server-Sent Events for the firm console. "task" when the plan gains a task (a payout batch, a
 * re-notice after an UNCLAIMED payout), "payment" when a payment changes status, "ping" every 15 seconds.
 */
export async function GET(req: Request) {
  const got = await ctxOr();
  if ("error" in got) return got.error;
  return new Response(liveStream(got.ctx.firm, got.recall.number, req.signal), {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
