import { fail } from "@/lib/api/envelope";
import { withRequest } from "@/lib/log";
import { claimPhoto, isClaimId } from "../../_lib/claims";
import { pictureLimit } from "../../_lib/http";

/** GET /api/claims/{id}/photo: the claim's stored photo (resized JPEG), for the owner's receipt. Limited per visitor. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequest(req, "GET /api/claims/{id}/photo", async () => {
    const limited = await pictureLimit(req);
    if (limited) return limited;
    const { id } = await ctx.params;
    if (!isClaimId(id)) return fail("invalid_request", "That claim id does not look right.", 400);
    const p = await claimPhoto(id);
    if (!p) return fail("not_found", "There is no photo for that claim.", 404);
    return new Response(new Uint8Array(p.bytes), { headers: { "Content-Type": p.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  });
}
