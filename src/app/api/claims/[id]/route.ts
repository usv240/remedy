import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { getClaimView, isClaimId } from "../_lib/claims";
import { failFrom } from "../_lib/http";

/**
 * GET /api/claims/{id} (documented as /api/v1/claims/{id}): where a claim stands, its six checks, the decision and the
 * payment. `?refresh=1` first asks PayPal for the payment's latest status (the receipt polls this while a payout is on
 * its way; webhooks remain the durable path). No personal data: the payee is masked.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(req, "GET /api/claims/{id}", async () => {
    const started = Date.now();
    const { id } = await ctx.params;
    if (!isClaimId(id)) return fail("invalid_request", "That claim id does not look right.", 400);
    try {
      const view = await getClaimView(id, { refresh: new URL(req.url).searchParams.get("refresh") === "1" });
      if (!view) return fail("not_found", "There is no claim with that id.", 404);
      return ok(view, started);
    } catch (e) {
      return failFrom(e);
    }
  });
}
