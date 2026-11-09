import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { dbConfigured } from "@/lib/db";
import { log } from "@/lib/log";
import { paypalConfigured } from "@/lib/paypal/client";
import { paypalEnv } from "@/lib/paypal/env";
import { clientIp, clientKey } from "@/lib/ratelimit";
import { sendTryPayout } from "../_lib/sandbox-payout";
import { tryPayoutDeps } from "../_lib/sandbox-payout-db";

/**
 * POST /api/try/sandbox-payout: "Send $34.99 to the sandbox buyer" on /try, after Brightline's sample charger checks
 * out. A real PayPal sandbox payout to the sandbox personal account TESTING.md publishes, through the router and the
 * payouts code, once a day per visitor and inside the sandbox's daily ceiling; past a limit, the most recent receipt.
 * The answer carries the receipt's URL, PayPal's payout_batch_id and its status. With PAYPAL_ENV=live it sends
 * nothing: the sandbox buyer exists only in the sandbox.
 */
export async function POST(req: Request) {
  return guard(req, "POST /api/try/sandbox-payout", async () => {
    const started = Date.now();
    if (!dbConfigured()) return fail("upstream_unavailable", "The sandbox payout needs the database, which is not set up on this server.", 503);
    if (paypalEnv() === "live") return fail("forbidden", "This one-click payout pays the PayPal sandbox buyer, so it is off on a live PayPal account.", 403);
    if (!paypalConfigured()) return fail("upstream_unavailable", "PayPal sandbox keys are not set on this server, so no sandbox payout can be sent. The README says how to add them.", 503);
    try {
      return ok(await sendTryPayout({ visitorKey: clientKey(`${clientIp(req)}|${(req.headers.get("user-agent") ?? "").slice(0, 200)}`) }, tryPayoutDeps), started);
    } catch (e) {
      log.error("try sandbox payout failed", { error: e });
      return fail("internal", "The sandbox payout could not be sent just now. Please try again.", 500);
    }
  });
}
