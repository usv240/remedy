// Recompute the audit ledger's hash chain straight from the database, without the web server.
// Exit code 0 when every entry links to the one before it; 1 with the first entry that does not.
import { verifyLedger } from "../src/lib/audit";

async function main() {
  const r = await verifyLedger();
  console.log(r.ok ? `Ledger verified: ${r.count} entries, every hash links to the one before it.` : `Ledger check found a changed entry at position ${r.brokenAt} of ${r.count}.`);
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
