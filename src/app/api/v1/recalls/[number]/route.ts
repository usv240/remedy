import { connection } from "next/server";
import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { recallDetail, refreshOverlay } from "@/lib/api/recall-data";

/** GET /api/v1/recalls/{number}: one recall, its official images, the remedy as published, and its proof rule. */
export async function GET(req: Request, ctx: { params: Promise<{ number: string }> }) {
  await connection();
  return guard(req, "v1.recall", async () => {
    const started = Date.now();
    const { number } = await ctx.params;
    await refreshOverlay();
    const r = recallDetail(decodeURIComponent(number));
    if (!r) return fail("not_found", `There is no recall ${number} in Remedy's data, which covers CPSC recalls since January 2024.`, 404);
    return ok(r, started);
  });
}
