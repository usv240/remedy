import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ctxOr, jsonBody } from "@/lib/firm/api";
import { targetsFor } from "@/lib/firm/buyers-data";
import { findBuyers, importBuyersAsSales } from "@/lib/payments";
import { paypalConfigured } from "@/lib/paypal/client";
import { maskContact } from "@/lib/secure";

/**
 * POST /api/firm/buyers/paypal { start, end, import? }: buyers of the recalled product who paid the firm with PayPal,
 * from PayPal Transaction Search (31-day windows). PayPal's sandbox can take up to three hours to list a purchase.
 * With import: true the matches are saved as sales, so their claims are refunded to the original payment.
 */
export async function POST(req: Request) {
  return guard(req, "firm.buyers.paypal", async () => {
    const started = Date.now();
    const body = await jsonBody<{ start?: unknown; end?: unknown; import?: unknown; recall?: unknown }>(req);
    const got = await ctxOr({ recall: typeof body?.recall === "string" ? body.recall : null });
    if ("error" in got) return got.error;
    if (!paypalConfigured()) return fail("upstream_unavailable", "PayPal is not connected on this server, so use a sales file instead.", 503);
    const start = typeof body?.start === "string" ? new Date(`${body.start}T00:00:00Z`) : null;
    const end = typeof body?.end === "string" ? new Date(`${body.end}T23:59:59Z`) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return fail("invalid_request", "Choose a start and an end date.", 400);
    if (end.getTime() - start.getTime() > 3 * 366 * 86_400_000) return fail("invalid_request", "Search up to three years at a time.", 400);
    const targets = targetsFor(got.recall);
    const runs = await Promise.all(targets.map((product) => findBuyers({ start, end, product })));
    const seen = new Map<string, (typeof runs)[number]["buyers"][number]>();
    for (const r of runs) for (const b of r.buyers) if (!seen.has(b.captureId) || seen.get(b.captureId)!.matchScore < b.matchScore) seen.set(b.captureId, b);
    const buyers = [...seen.values()];
    const imported = body?.import === true && buyers.length ? await importBuyersAsSales(buyers) : null;
    return ok(
      {
        buyers: buyers.map((b) => ({ ...b, buyerEmail: b.buyerEmail ? maskContact(b.buyerEmail) : null, buyerName: null })),
        scanned: runs.reduce((s, r) => s + r.scanned, 0),
        windows: runs[0]?.windows ?? [],
        imported,
        note: runs[0]?.note ?? "PayPal's sandbox can take up to three hours to list a new purchase in Transaction Search.",
      },
      started,
    );
  });
}
