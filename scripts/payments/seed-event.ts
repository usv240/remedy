// A seeded payout status, for the Gantt "Re-notice" demo when a real one is not at hand.
// A real UNCLAIMED item is easy in the sandbox (pay an email with no PayPal account; see sandbox-probe.ts), but
// RETURNED only happens 30 days later, and PayPal's negative testing has no mock code for either. This applies the
// status through the same recordStatus path a webhook uses, with source "seed", so the ledger says it was seeded.
// The claim is then marked origin 'test' (src/lib/firm/origin.ts): a page already open sees its re-notice arrive, and
// the firm console leaves it out of every list and count from then on.
//   npx tsx --env-file=.env.local scripts/payments/seed-event.ts --claim <claim uuid> --status returned
import { sql } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { TEST_ORIGIN } from "../../src/lib/firm/origin";
import { resolveDeps } from "../../src/lib/payments/deps";
import { recordStatus } from "../../src/lib/payments/events";
import type { PaymentStatus } from "../../src/lib/payments/types";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const claim = arg("--claim");
  const status = (arg("--status") ?? "returned") as PaymentStatus;
  if (!claim || !["unclaimed", "returned"].includes(status)) throw new Error("Use --claim <id> --status unclaimed|returned");
  const deps = await resolveDeps();
  const payment = await deps.store.getPaymentByClaim(claim);
  if (!payment || payment.route !== "payout") throw new Error("That claim has no payout yet.");
  const r = await recordStatus(payment, status, { paypalStatus: status.toUpperCase(), issue: "SEEDED_FOR_DEMO" }, "seed", deps);
  await db().execute(sql`update claim set origin = ${TEST_ORIGIN} where id = ${claim}::uuid`);
  console.log(r.changed ? `Payment ${payment.id} is now ${status}${r.event?.task ? `; added task ${r.event.task.key}` : ""}.` : `Payment ${payment.id} was already ${status}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("seed failed:", (e as Error).message);
  process.exit(1);
});
