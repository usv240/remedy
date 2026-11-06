import { createHash } from "node:crypto";
import { asc, desc, sql } from "drizzle-orm";
import { db, schema } from "./db";

const GENESIS = "0".repeat(64);

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export function hashEvent(prevHash: string, e: { at: string; actor: string; action: string; ref: string; detail: unknown }) {
  return createHash("sha256").update(prevHash + canonical(e)).digest("hex");
}

/** Any fixed number works; every append takes this one lock. */
const LEDGER_LOCK = 4_147_201;

/**
 * Append one event to the hash-chained ledger. Detail never holds raw personal data.
 * Appends take a transaction-scoped advisory lock, so two at once (a webhook arriving while the return route
 * captures, or checks running in parallel) cannot both chain from the same entry. Without it, 25 parallel
 * appends broke the chain; scripts/ledger-race.ts checks this.
 */
export async function audit(actor: "person" | "agent" | "system" | "webhook", action: string, ref: string, detail: Record<string, unknown> = {}) {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK})`);
    const [last] = await tx.select({ hash: schema.auditEvents.hash }).from(schema.auditEvents).orderBy(desc(schema.auditEvents.id)).limit(1);
    const prevHash = last?.hash ?? GENESIS;
    const at = new Date();
    const hash = hashEvent(prevHash, { at: at.toISOString(), actor, action, ref, detail });
    await tx.insert(schema.auditEvents).values({ at, actor, action, ref, detail, prevHash, hash });
    return hash;
  });
}

type LedgerRow = typeof schema.auditEvents.$inferSelect;

/** Recompute a chain of events from the first. Returns the first event whose fingerprint does not match, if any. */
export function verifyChain(rows: LedgerRow[]) {
  let prev = GENESIS;
  for (const r of rows) {
    const expect = hashEvent(prev, { at: r.at.toISOString(), actor: r.actor, action: r.action, ref: r.ref, detail: r.detail });
    if (r.prevHash !== prev || r.hash !== expect) return { ok: false as const, count: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true as const, count: rows.length };
}

export async function ledgerRows() {
  return db().select().from(schema.auditEvents).orderBy(asc(schema.auditEvents.id));
}

/** Recompute the whole stored chain. */
export async function verifyLedger() {
  return verifyChain(await ledgerRows());
}
