import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ctxOr, jsonBody, reviewerName } from "@/lib/firm/api";
import { askForRetake } from "@/lib/firm/queue";

/** POST /api/firm/claims/{id}/retake { reviewer?, note? }: ask the owner for a new photo, with a friendly message. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guard(req, "firm.claims.retake", async () => {
    const started = Date.now();
    const got = await ctxOr();
    if ("error" in got) return got.error;
    const { id } = await params;
    const body = await jsonBody<{ reviewer?: unknown; note?: unknown }>(req);
    const r = await askForRetake(got.ctx.firm, id, reviewerName(body?.reviewer), typeof body?.note === "string" ? body.note : null);
    if (!r.ok) return fail("invalid_request", r.plain, 409);
    return ok(r, started);
  });
}
