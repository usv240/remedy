import { ctxOr } from "@/lib/firm/api";
import { claimPhoto } from "@/lib/firm/queue";

/** GET /api/firm/claims/{id}/photo: the claim's stored photo, for the grid thumbnail and the drawer. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await ctxOr();
  if ("error" in got) return got.error;
  const { id } = await params;
  const p = await claimPhoto(got.ctx.firm.id, id);
  if (!p?.bytes) return new Response("Not found", { status: 404 });
  const mime = /^image\/(jpeg|png|webp|gif)$/.test(p.mime) ? p.mime : "application/octet-stream";
  return new Response(new Uint8Array(p.bytes), { headers: { "content-type": mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}
