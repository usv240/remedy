// Issues a firm's own hash-pool key: the one kind of key that may register hashes in the shared pool
// (POST /api/v1/hash-pool/register). The operator runs it when a firm connects, and hands the key to that firm.
//
//   npx tsx --env-file=.env.local scripts/hash-pool-key.ts --firm brightline-home [--email recalls@example.com]
//
// The key is tied to the firm (scopes hash-pool:register and firm:<id>, src/lib/api/keys.ts) and printed once, on
// stdout only; the database keeps its SHA-256 hash. A self-serve sandbox key from the Developers page can check hashes
// but is refused when it tries to register one. Revoke a firm key by setting api_key.revoked_at.
import { sql } from "drizzle-orm";
import { issueFirmKey } from "../src/lib/api/keys";
import { audit } from "../src/lib/audit";
import { db, dbConfigured } from "../src/lib/db";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  if (!dbConfigured()) throw new Error("DATABASE_URL is not set. Run with: npx tsx --env-file=.env.local scripts/hash-pool-key.ts --firm <slug>");
  const slug = arg("firm");
  if (!slug) throw new Error("Name the firm: --firm <slug> (for example brightline-home).");
  const [firm] = (await db().execute(sql`select id, name, slug from firm where slug = ${slug} limit 1`)).rows as { id: number; name: string; slug: string }[];
  if (!firm) throw new Error(`No firm with slug ${slug}.`);
  const email = arg("email") ?? `recalls@${firm.slug}.example.com`;
  const { key, row } = await issueFirmKey({ firmId: firm.id, firmName: firm.name, email });
  await audit("person", "hash_pool.firm_key_issued", `firm:${firm.id}`, { key_id: row.id, prefix: row.prefix });
  console.error(`hash-pool-key: issued key ${row.prefix}... (id ${row.id}) for ${firm.name}. It is printed once, below; Remedy keeps only its hash.`);
  process.stdout.write(`${key}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("hash-pool-key failed:", (e as Error).message);
  process.exit(1);
});
