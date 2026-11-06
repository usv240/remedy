import { fail } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { getPreset, readRecorded, runPreset } from "../../_lib/presets";

/**
 * GET /api/try/presets/{id}: download a preset as JSON: its input, what it should show, the recorded model answer it
 * replays, and the verifier's answer from a fresh run. The photo is at /api/try/presets/{id}/photo?download=1.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(req, "GET /api/try/presets/{id}", async () => {
    const { id } = await ctx.params;
    const p = getPreset(id);
    if (!p) return fail("not_found", "There is no example with that id.", 404);
    const run = await runPreset(p);
    const technical = p.technical ? await runPreset(p, { technical: true }) : null;
    const body = {
      preset: { id: p.id, title: p.title, summary: p.summary, recall: p.recall, expected: p.expected, photo: `/api/try/presets/${p.id}/photo?download=1`, photo_credit: p.photo_credit },
      result: run.result,
      replay: run.replay,
      technical_run: technical ? { note: p.technical!.note, options: p.technical!.options, result: technical.result, replay: technical.replay } : null,
      recorded_model_answer: readRecorded(p.recorded)?.vision?.report ?? null,
      how_to_try: `POST the photo with recall=${p.recall} to /api/claims (multipart) to run it as a claim. Recorded answers replay what Claude Opus 5.5 said once, live; every check around them runs again in code.`,
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="remedy-preset-${p.id}.json"` },
    });
  });
}
