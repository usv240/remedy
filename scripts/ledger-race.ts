// Fires many ledger appends at once, recomputes the chain, then removes its own entries (they are always the newest,
// so the chain before them is untouched). Run: npx tsx --env-file=.env.local scripts/ledger-race.ts [count]
import { eq } from "drizzle-orm";
import { audit, verifyLedger } from "../src/lib/audit";
import { db, schema } from "../src/lib/db";

async function main() {
  const n = Number(process.argv[2] ?? 25);
  await Promise.all(Array.from({ length: n }, (_, i) => audit("system", "test.ledger_race", `race:${i}`, { i })));
  const during = await verifyLedger();
  await db().delete(schema.auditEvents).where(eq(schema.auditEvents.action, "test.ledger_race"));
  const after = await verifyLedger();
  console.log(JSON.stringify({ appended: n, chainWithRaceEntries: during, chainAfterCleanup: after }));
}

main().then(() => process.exit(0));
