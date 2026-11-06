// Applies the reviewed schema, db/schema.sql, to DATABASE_URL. Every statement in it is idempotent, so this runs
// before each release (render.yaml preDeployCommand) and in CI on an empty database. It never drops or rewrites a
// table: a change to an existing table is written as a reviewed statement in db/schema.sql first.
//
//   node --env-file-if-exists=.env.local scripts/migrate.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: DATABASE_URL is not set.");
  process.exit(1);
}
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "db", "schema.sql"), "utf8");
const client = new pg.Client({ connectionString: url, ssl: url.includes("render.com") ? { rejectUnauthorized: false } : undefined });
await client.connect();
try {
  // Notices ("already exists, skipping") are expected on every run after the first.
  client.on("notice", () => {});
  await client.query(sql);
  const { rows } = await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
  console.log(`migrate: db/schema.sql applied; ${rows[0].n} tables.`);
} finally {
  await client.end();
}
