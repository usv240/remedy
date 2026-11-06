import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { isClaimId, payForClaim, type PayInput } from "../../_lib/claims";
import { failFrom } from "../../_lib/http";

/**
 * POST /api/claims/{id}/pay (documented as /api/v1/claims/{id}/pay): where the refund goes, then pay it (sandbox).
 *
 *   { "choice": "money", "payee_type": "email" | "phone" | "venmo", "payee": "jordan@example.com" }
 *   { "choice": "replacement", "replacement_id": "<Channel3 product id>" }
 *
 * A linked PayPal purchase inside 180 days is refunded to its capture and needs no payee. The firm's auto rule pays a
 * verified claim at or under its cap straight away; anything else waits for a person at the firm. Calling it twice
 * never pays twice.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(req, "POST /api/claims/{id}/pay", async () => {
    const started = Date.now();
    const { id } = await ctx.params;
    if (!isClaimId(id)) return fail("invalid_request", "That claim id does not look right.", 400);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("invalid_request", "Send JSON with a choice: money or replacement.", 400);
    const choice = body.choice === "replacement" ? "replacement" : body.choice === "money" || body.choice === undefined ? "money" : null;
    const payeeType = body.payee_type === "email" || body.payee_type === "phone" || body.payee_type === "venmo" ? body.payee_type : null;
    if (!choice) return fail("invalid_request", "choice must be money or replacement.", 400);
    if (body.payee_type !== undefined && body.payee_type !== null && !payeeType) return fail("invalid_request", "payee_type must be email, phone or venmo.", 400);
    const input: PayInput = {
      choice,
      payee_type: payeeType,
      payee: typeof body.payee === "string" ? body.payee.slice(0, 254) : null,
      replacement_id: typeof body.replacement_id === "string" ? body.replacement_id.slice(0, 120) : null,
    };
    try {
      return ok(await payForClaim(id, input), started);
    } catch (e) {
      return failFrom(e);
    }
  });
}
