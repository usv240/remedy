import { ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { listPresets, recordedSamples } from "../_lib/presets";

/**
 * GET /api/try/presets: the ready-made examples, with what each is expected to show; the photos of the sample charger
 * shown with their recorded results (recorded); and the team's own photos when there are some (user).
 */
export async function GET(req: Request) {
  return guard(req, "GET /api/try/presets", async () => {
    const started = Date.now();
    const { note, presets, user } = listPresets();
    const shape = (p: (typeof presets)[number]) => ({ id: p.id, title: p.title, summary: p.summary, recall: p.recall, group: p.group ?? null, expected: p.expected, photo: `/api/try/presets/${p.id}/photo`, photo_credit: p.photo_credit, user: Boolean(p.user) });
    const recorded = recordedSamples().map((s) => ({ id: s.id, title: s.title, summary: s.summary, expected: s.expected, photo: s.thumb, photo_credit: s.photo_credit, recorded: s.recorded }));
    return ok({ note, presets: presets.map(shape), recorded, user: user.map(shape) }, started);
  });
}
