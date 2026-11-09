/**
 * The one-click sandbox payout's connections (src/app/api/try/_lib/sandbox-payout.ts): the sandbox buyer, the router's
 * 24-hour ceiling count, the rate buckets, the claim it opens and the payment through payForClaim, which plans it with
 * planPayment and pays it with payClaims like every other claim. Server only.
 */
import { sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { SAMPLE_RECALL } from "@/lib/firm/firm";
import { payFromDb } from "@/lib/firm/queue";
import { readyPayee, sampleChecks, samplePhotoIds, sampleResult } from "@/lib/firm/sample-claims";
import { resolveDeps } from "@/lib/payments/deps";
import { describeStatus } from "@/lib/payments/status";
import type { PaymentStatus } from "@/lib/payments/types";
import { hit } from "@/lib/ratelimit";
import { maskContact } from "@/lib/secure";
import { payForClaim } from "../../claims/_lib/claims";
import { firmTerms } from "../../claims/_lib/terms";
import type { ClaimView } from "../../claims/_lib/types";
import type { TryPayoutDeps, TryReceipt } from "./sandbox-payout";

const DAY = 86_400_000;
const receiptOf = (claimId: string, p: ClaimView["payment"] | null, at: string | null): TryReceipt => ({
  claimId,
  url: `/r/${claimId}`,
  batchId: p?.ids.payout_batch_id ?? null,
  itemId: p?.ids.payout_item_id ?? null,
  status: p?.paypal_status ?? p?.status ?? null,
  statusPlain: p?.status_plain ?? null,
  at,
});

export const tryPayoutDeps: TryPayoutDeps = {
  payee: readyPayee,
  paidLast24hCents: async () => (await resolveDeps()).store.sumPaymentsSince(new Date(Date.now() - DAY)),
  allow: async (bucket, limit) => (await hit(bucket, limit, DAY)).ok,
  latestReceipt: async () => {
    const [r] = (
      await db().execute(sql`
      select c.id, p.status, p.route, p.paypal_status, p.paypal_batch_id, p.paypal_item_id, p.created_at
      from claim c join lateral (select * from payment x where x.claim_id = c.id order by x.id desc limit 1) p on true
      where c.channel = 'preset' and c.is_sample and p.paypal_batch_id is not null
      order by p.created_at desc limit 1`)
    ).rows as { id: string; status: string; route: string; paypal_status: string | null; paypal_batch_id: string; paypal_item_id: string | null; created_at: Date }[];
    if (!r) return null;
    const words = describeStatus(payFromDb(r.status, r.route) as PaymentStatus, (r.route ?? "payout") as "payout");
    return { claimId: r.id, url: `/r/${r.id}`, batchId: r.paypal_batch_id, itemId: r.paypal_item_id, status: r.paypal_status ?? r.status, statusPlain: words.plain, at: new Date(r.created_at).toISOString() };
  },
  openClaim: async ({ amountCents }) => {
    // The claim the payout pays: Brightline's sample charger with its cord cut, carrying the recorded run's checks the
    // /try result just showed (src/lib/firm/samples/claim-runs.json). Marked sample; its payment is a real sandbox one.
    const terms = await firmTerms(SAMPLE_RECALL);
    const photo = (await samplePhotoIds().catch(() => ({}) as Awaited<ReturnType<typeof samplePhotoIds>>)).made_safe ?? null;
    const result = { ...sampleResult("paid", 0), source: "try" };
    const [row] = (
      await db().execute(sql`
      insert into claim (recall_number, firm_id, photo_id, checks, decision, status, amount, channel, is_sample, decided_at, result)
      values (${SAMPLE_RECALL}, ${terms.firmId}, ${photo}::uuid, ${JSON.stringify(sampleChecks("paid", 0))}::jsonb, 'verified', 'verified',
              ${(amountCents / 100).toFixed(2)}, 'preset', true, now(), ${JSON.stringify(result)}::jsonb)
      returning id`)
    ).rows as { id: string }[];
    await audit("person", "claim.submitted", `claim:${row.id}`, { recall: SAMPLE_RECALL, source: "try", preset: "sample-charger-cut", sample: true });
    await audit("system", "claim.decided", `claim:${row.id}`, { decision: "verified", decided_by: result.decided_by, recorded_run: result.recorded?.file ?? null });
    return row.id;
  },
  pay: async (claimId, payee) => {
    const r = await payForClaim(claimId, { choice: "money", payee_type: "email", payee });
    const p = r.claim.payment;
    const ok = (r.kind === "sent" || r.kind === "already") && Boolean(p?.ids.payout_batch_id);
    return { ok, plain: r.plain, receipt: receiptOf(claimId, p, p?.updated_at ?? null) };
  },
  mask: maskContact,
};
