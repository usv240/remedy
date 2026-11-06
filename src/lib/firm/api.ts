/**
 * Shared pieces of the firm console's API routes (src/app/api/firm/**): the sample firm and its recall, and the API
 * envelope. Writes go through the public API's per-client rate limit (src/lib/api/keys.ts guard). Server only.
 */
import { connection } from "next/server";
import { fail } from "@/lib/api/envelope";
import { dbConfigured } from "@/lib/db";
import { firmContext, type FirmRecall } from "./firm";

export type Ctx = NonNullable<Awaited<ReturnType<typeof firmContext>>>;

/** The firm and its recalls, or the error response to return. */
export async function ctxOr(res?: { recall?: string | null }): Promise<{ ctx: Ctx; recall: FirmRecall } | { error: Response }> {
  await connection();
  if (!dbConfigured()) return { error: fail("upstream_unavailable", "The database is not connected on this server.", 503) };
  const ctx = await firmContext();
  if (!ctx || !ctx.main) return { error: fail("not_found", "The sample firm is not set up yet. Run scripts/seed.ts and scripts/seed-firm.ts.", 404) };
  const recall = res?.recall ? ctx.recalls.find((r) => r.number === res.recall) : ctx.main;
  if (!recall) return { error: fail("not_found", "That recall is not one of this firm's recalls.", 404) };
  return { ctx, recall };
}

/** A JSON body, or null when it is missing or not JSON. Bodies over 64 KB are refused. */
export async function jsonBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  const text = await req.text().catch(() => "");
  if (!text || text.length > 65_536) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** The reviewer's name as typed, short and plain, or the default. */
export const reviewerName = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/[<>]/g, "").slice(0, 60) : "Ana (Brightline Home)");
