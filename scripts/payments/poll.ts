// Reconcile open payments by polling PayPal, for when webhooks cannot reach this server (localhost, a preview).
//   npx tsx --env-file=.env.local scripts/payments/poll.ts            one pass
//   npx tsx --env-file=.env.local scripts/payments/poll.ts --every 30 a pass every 30 seconds until stopped
// Same path as the webhook (recordStatus), so status changes, ledger events and Re-notice tasks happen once.
import { reconcileOpenPayments } from "../../src/lib/payments/reconcile";

const everyArg = process.argv.indexOf("--every");
const every = everyArg > 0 ? Math.max(5, Number(process.argv[everyArg + 1]) || 30) : 0;

async function pass() {
  const r = await reconcileOpenPayments();
  const at = new Date().toISOString().slice(11, 19);
  console.log(`${at} open ${r.open}, batches ${r.batches}, refunds ${r.refunds}, orders ${r.orders}, changed ${r.changed}, waiting for retry ${r.waitingForRetry}${r.errors.length ? `, errors: ${r.errors.join("; ")}` : ""}`);
}

async function main() {
  await pass();
  if (!every) process.exit(0);
  setInterval(() => void pass().catch((e) => console.error("poll failed:", (e as Error).message)), every * 1000);
}

main().catch((e) => {
  console.error("poll failed:", (e as Error).message);
  process.exit(1);
});
