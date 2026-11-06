import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { isClaimId, replacementOptions } from "../../_lib/claims";
import { failFrom } from "../../_lib/http";

/**
 * GET /api/claims/{id}/replacements: safe replacements from Channel3 at or under the refund, each checked against
 * Remedy's recall list; only products with no matching recall are offered.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(req, "GET /api/claims/{id}/replacements", async () => {
    const started = Date.now();
    const { id } = await ctx.params;
    if (!isClaimId(id)) return fail("invalid_request", "That claim id does not look right.", 400);
    try {
      return ok(await replacementOptions(id), started);
    } catch (e) {
      return failFrom(e);
    }
  });
}
