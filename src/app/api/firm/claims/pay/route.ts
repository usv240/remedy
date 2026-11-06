import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ctxOr, jsonBody, reviewerName } from "@/lib/firm/api";
import { approveAndPay } from "@/lib/firm/queue";

/**
 * POST /api/firm/claims/pay { claim_ids, reviewer?, reviewed? }: "Approve and pay". Builds and approves each claim's
 * PaymentPlan, then pays them together (one PayPal Payouts batch for the payouts). Sandbox only, rate limited, at most
 * 25 claims a call; the payments engine also caps each payment and the day's total.
 */
export async function POST(req: Request) {
  return guard(req, "firm.claims.pay", async () => {
    const started = Date.now();
    const got = await ctxOr();
    if ("error" in got) return got.error;
    const body = await jsonBody<{ claim_ids?: unknown; reviewer?: unknown; reviewed?: unknown }>(req);
    const ids = Array.isArray(body?.claim_ids) ? body.claim_ids.filter((x): x is string => typeof x === "string").slice(0, 25) : [];
    if (!ids.length) return fail("invalid_request", "Choose at least one claim to pay.", 400);
    const results = await approveAndPay(got.ctx.firm, ids, reviewerName(body?.reviewer), { reviewed: body?.reviewed === true && ids.length === 1 });
    const sent = results.filter((r) => r.kind === "sent").length;
    return ok({ results, sent, label: "Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm." }, started);
  });
}
