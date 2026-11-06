import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __remedyPool: Pool | undefined;
}

export function dbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function pool() {
  // One pool per server process, reused across hot reloads in development.
  globalThis.__remedyPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    ssl: process.env.DATABASE_URL?.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  return globalThis.__remedyPool;
}

export const db = () => drizzle(pool(), { schema });
export { schema };
