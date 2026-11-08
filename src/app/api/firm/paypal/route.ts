import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ctxOr, jsonBody } from "@/lib/firm/api";
import { accountView, connectAccount, disconnectAccount } from "@/lib/paypal/firm-account";

/** GET /api/firm/paypal: which PayPal account this firm's refunds and payouts come from. Never returns a secret. */
export async function GET(req: Request) {
  return guard(req, "firm.paypal", async () => {
    const started = Date.now();
    const got = await ctxOr();
    if ("error" in got) return got.error;
    return ok({ account: await accountView(got.ctx.firm.id) }, started);
  });
}

/**
 * POST /api/firm/paypal { client_id, secret }: connect the firm's own PayPal REST app (sandbox). PayPal checks the pair
 * first; a firm's own console stores them sealed and pays from them, the sample firm's open console only checks them.
 */
export async function POST(req: Request) {
  return guard(req, "firm.paypal.connect", async () => {
    const started = Date.now();
    const got = await ctxOr();
    if ("error" in got) return got.error;
    const body = await jsonBody<{ client_id?: unknown; secret?: unknown }>(req);
    const clientId = typeof body?.client_id === "string" ? body.client_id : "";
    const secret = typeof body?.secret === "string" ? body.secret : "";
    if (!clientId || !secret) return fail("invalid_request", "Add your PayPal app's client ID and secret.", 400);
    const r = await connectAccount(got.ctx.firm.id, { clientId, secret });
    if (!r.ok) return fail("invalid_request", r.plain, 400);
    return ok({ stored: r.stored, account: r.view, plain: r.plain }, started);
  });
}

/** DELETE /api/firm/paypal: remove the firm's own credentials; it pays from the platform's sandbox account again. */
export async function DELETE(req: Request) {
  return guard(req, "firm.paypal.disconnect", async () => {
    const started = Date.now();
    const got = await ctxOr();
    if ("error" in got) return got.error;
    return ok({ account: await disconnectAccount(got.ctx.firm.id) }, started);
  });
}
