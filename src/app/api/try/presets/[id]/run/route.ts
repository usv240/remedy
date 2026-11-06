import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { log } from "@/lib/log";
import { getPreset, runPreset } from "../../../_lib/presets";

/**
 * POST /api/try/presets/{id}/run: run a ready-made example through the verifier. `{ "technical": true }` runs its
 * second configuration where it has one. Never creates a claim and never pays.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(req, "POST /api/try/presets/{id}/run", async () => {
    const started = Date.now();
    const { id } = await ctx.params;
    const p = getPreset(id);
    if (!p) return fail("not_found", "There is no example with that id.", 404);
    const body = (await req.json().catch(() => ({}))) as { technical?: unknown };
    try {
      return ok(await runPreset(p, { technical: body.technical === true }), started);
    } catch (e) {
      log.error("preset run failed", { preset: id, error: e });
      return fail("internal", "This example could not run just now. Please try again.", 500);
    }
  });
}
