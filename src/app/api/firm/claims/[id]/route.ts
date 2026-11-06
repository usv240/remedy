import { fail, ok } from "@/lib/api/envelope";
import { ctxOr } from "@/lib/firm/api";
import { claimDetail } from "@/lib/firm/queue";

/** GET /api/firm/claims/{id}: one claim for the drawer: photo, proof rule, checks with reasons, Two reviewers, plan. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  const got = await ctxOr();
  if ("error" in got) return got.error;
  const { id } = await params;
  const detail = await claimDetail(got.ctx.firm, id);
  if (!detail) return fail("not_found", "That claim was not found.", 404);
  return ok(detail, started);
}
