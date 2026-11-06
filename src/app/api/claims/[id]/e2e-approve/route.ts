import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { approveAndPayForTest, isClaimId } from "../../_lib/claims";
import { failFrom, isTestRequest } from "../../_lib/http";

/**
 * POST /api/claims/{id}/e2e-approve: end-to-end tests only. Approves the claim's payment plan as the firm's reviewer
 * would, then pays it, so the sandbox payout and receipt path is tested without a person. Needs this server's
 * CHECKS_SECRET in the x-checks-secret header; without it the route does not exist.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isTestRequest(req)) return fail("not_found", "Not found.", 404);
  return guard(req, "POST /api/claims/{id}/e2e-approve", async () => {
    const started = Date.now();
    const { id } = await ctx.params;
    if (!isClaimId(id)) return fail("invalid_request", "That claim id does not look right.", 400);
    try {
      return ok(await approveAndPayForTest(id), started);
    } catch (e) {
      return failFrom(e);
    }
  });
}
