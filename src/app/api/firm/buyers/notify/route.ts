import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ctxOr, jsonBody } from "@/lib/firm/api";
import { notifySales } from "@/lib/firm/buyers-data";
import { publicOrigin } from "@/lib/origin";

/**
 * POST /api/firm/buyers/notify { sale_ids, recall? }: create a personal claim link for each matched buyer (the notice
 * table keeps only the link token's hash). No mail service is connected, so each notice is logged as "would send".
 */
export async function POST(req: Request) {
  return guard(req, "firm.buyers.notify", async () => {
    const started = Date.now();
    const body = await jsonBody<{ sale_ids?: unknown; recall?: unknown }>(req);
    const got = await ctxOr({ recall: typeof body?.recall === "string" ? body.recall : null });
    if ("error" in got) return got.error;
    const ids = Array.isArray(body?.sale_ids) ? body.sale_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!ids.length) return fail("invalid_request", "Choose at least one matched buyer.", 400);
    const links = await notifySales(got.ctx.firm, got.recall, ids, publicOrigin(req));
    return ok({ links, sent: 0, would_send: links.filter((l) => l.status === "would_send").length, delivery: "stub: no mail service connected, so nothing was emailed or texted" }, started);
  });
}
