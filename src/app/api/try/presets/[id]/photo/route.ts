import { fail } from "@/lib/api/envelope";
import { withRequest } from "@/lib/log";
import { pictureLimit } from "../../../../claims/_lib/http";
import { getPreset, presetPhoto } from "../../../_lib/presets";

/** GET /api/try/presets/{id}/photo: the preset's photo. `?download=1` saves it as a file. Limited per visitor. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequest(req, "GET /api/try/presets/{id}/photo", async () => {
    const limited = await pictureLimit(req);
    if (limited) return limited;
    const { id } = await ctx.params;
    const p = getPreset(id);
    if (!p) return fail("not_found", "There is no example with that id.", 404);
    const { bytes, mime, name } = presetPhoto(p);
    const headers: Record<string, string> = { "Content-Type": mime, "Cache-Control": "public, max-age=86400" };
    if (new URL(req.url).searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="${name}"`;
    return new Response(new Uint8Array(bytes), { headers });
  });
}
