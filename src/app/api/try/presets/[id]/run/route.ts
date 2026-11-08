import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { log } from "@/lib/log";
import { clientIp, clientKey, hit } from "@/lib/ratelimit";
import { getPreset, LIVE_PRESET, liveGate, runPreset } from "../../../_lib/presets";

/**
 * POST /api/try/presets/{id}/run: run a ready-made example through the verifier. `{ "technical": true }` runs its
 * second configuration where it has one. `{ "live": true }` on Brightline's sample charger runs it live against the
 * model, once a day per visitor and within the site's daily AI budget; otherwise the recorded run, with the reason.
 * Never creates a claim and never pays.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(req, "POST /api/try/presets/{id}/run", async () => {
    const started = Date.now();
    const { id } = await ctx.params;
    const p = getPreset(id);
    if (!p) return fail("not_found", "There is no example with that id.", 404);
    const body = (await req.json().catch(() => ({}))) as { technical?: unknown; live?: unknown };
    const wantsLive = body.live === true && p.id === LIVE_PRESET;
    try {
      const live = wantsLive ? await liveGate(async () => (await hit(`live-run:${clientKey(clientIp(req))}`, 1, 24 * 60 * 60_000)).ok) : undefined;
      return ok(await runPreset(p, { technical: body.technical === true, live }), started);
    } catch (e) {
      log.error("preset run failed", { preset: id, error: e });
      return fail("internal", "This example could not run just now. Please try again.", 500);
    }
  });
}
