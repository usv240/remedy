import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { liveLimit, MAX_PHOTO_BYTES, submitClaim, type SubmitInput } from "./_lib/claims";
import { failFrom, hasApiKey, isTestRequest } from "./_lib/http";
import { isRecallNumber } from "./_lib/recall-text";
import type { ClaimEvent } from "./_lib/types";

/**
 * POST /api/claims (documented as /api/v1/claims): a photo of the recalled product made safe, as multipart form data.
 *
 *   recall        CPSC recall number, for example 27056 (required)
 *   photo         JPEG or PNG, up to 15 MB (required)
 *   source        "web" or "try" (optional)
 *   sale_id, capture_id   the sample-shop purchase to refund, from the shop's receipt (optional)
 *   paypal_email  find the sample-shop purchase by the buyer's PayPal email instead (optional)
 *
 * The server stores the photo, runs the six checks and records the decision. With `Accept: text/event-stream` it
 * streams progress (claim, stage, result, error events); otherwise it answers once with the claim. Payment is a
 * separate step: POST /api/claims/{id}/pay.
 */
export async function POST(req: Request) {
  return guard(req, "POST /api/claims", async () => {
    const started = Date.now();
    const test = isTestRequest(req);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
    const limit = await liveLimit({ ip, keyed: hasApiKey(req), test });
    if (!limit.ok) {
      const res = fail("rate_limited", limit.message, 429);
      return new Response(res.body, { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(limit.retryAfter) } });
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("invalid_request", "Send the photo as multipart form data with a recall number.", 400);
    }
    const recall = String(form.get("recall") ?? "").trim();
    const photo = form.get("photo");
    if (!isRecallNumber(recall)) return fail("invalid_request", "Add the recall number, for example 27056.", 400);
    if (!(photo instanceof File) || photo.size === 0) return fail("invalid_request", "Please add a photo.", 400);
    if (photo.size > MAX_PHOTO_BYTES) return fail("invalid_request", "That photo is over 15 MB. Please send a smaller one.", 413);

    const amount = Number(form.get("e2e_amount") ?? "");
    const saleId = Number(form.get("sale_id") ?? "");
    const input: SubmitInput = {
      recallNumber: recall,
      photo: Buffer.from(await photo.arrayBuffer()),
      mime: photo.type || null,
      source: hasApiKey(req) ? "api" : form.get("source") === "try" ? "try" : form.get("source") === "link" ? "link" : "web",
      link: {
        saleId: Number.isInteger(saleId) && saleId > 0 ? saleId : null,
        captureId: String(form.get("capture_id") ?? "").trim().slice(0, 40) || null,
        paypalEmail: String(form.get("paypal_email") ?? "").trim().slice(0, 254) || null,
      },
      // Test-only switches: no live AI, and a $1 to $2 payout, so the sandbox flow is tested for free.
      test: test ? { noAi: form.get("e2e_no_ai") === "1", amountCents: Number.isFinite(amount) && amount >= 1 && amount <= 2 ? Math.round(amount * 100) : undefined } : null,
      noticeToken: String(form.get("notice") ?? "").trim().slice(0, 128) || null,
    };

    if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) {
      try {
        return ok(await submitClaim(input), started);
      } catch (e) {
        return failFrom(e);
      }
    }

    // Streamed: the claim id first, each stage as it starts and ends, then the result. If the phone drops the
    // connection, the claim still completes and GET /api/claims/{id} has the answer.
    const enc = new TextEncoder();
    let open = true;
    let ping: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (chunk: string) => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(chunk));
          } catch {
            open = false;
          }
        };
        const send = (e: ClaimEvent) => write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        ping = setInterval(() => write(": still checking\n\n"), 5000);
        submitClaim(input, send)
          .catch((e: unknown) => {
            const r = failFrom(e);
            return r.json().then((j: { error?: { code?: string; message?: string } }) => send({ type: "error", code: j.error?.code ?? "internal", message: j.error?.message ?? "Something went wrong." }));
          })
          .finally(() => {
            clearInterval(ping);
            if (open) {
              open = false;
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          });
      },
      cancel() {
        open = false;
        clearInterval(ping);
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
    });
  });
}
