import { ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { listPresets } from "../_lib/presets";

/** GET /api/try/presets: the ready-made examples, with what each is expected to show. */
export async function GET(req: Request) {
  return guard(req, "GET /api/try/presets", async () => {
    const started = Date.now();
    const { note, presets, user } = listPresets();
    const shape = (p: (typeof presets)[number]) => ({ id: p.id, title: p.title, summary: p.summary, recall: p.recall, expected: p.expected, photo: `/api/try/presets/${p.id}/photo`, photo_credit: p.photo_credit, user: Boolean(p.user) });
    return ok({ note, presets: presets.map(shape), user: user.map(shape), more_coming: user.length === 0 }, started);
  });
}
