import type { PaymentStore } from "./store";
import type { Ledger, Rest } from "./types";

/**
 * What every payments function needs: a store, the ledger, PayPal REST access and a clock. Production code passes
 * nothing and gets Postgres, the hash-chained ledger and the sandbox client. Tests pass a MemoryStore, an in-memory
 * ledger and a fake `rest`, so no network or database is touched. Defaults load lazily so tests never import them.
 */
export type PaymentsDeps = {
  store: PaymentStore;
  ledger: Ledger;
  rest: Rest;
  now: () => Date;
  /** The firm the money comes from. In this build, the sample firm's sandbox account. */
  firm: { id: string | null; name: string };
};

export const SAMPLE_FIRM_NAME = "Brightline Home (sample)";

/** Shown on every demo payout, refund and order. */
export const SANDBOX_LABEL = "Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm.";

/** Safety limits for the public sandbox demo. Every test payment stays under $50. */
export const LIMITS = { perPaymentCents: 5000, perDayCents: 50_000, bulkClaims: 50 } as const;

let defaults: Promise<PaymentsDeps> | null = null;

async function loadDefaults(): Promise<PaymentsDeps> {
  const [{ PgStore }, { audit }, { paypalRest }] = await Promise.all([import("./pg-store"), import("@/lib/audit"), import("@/lib/paypal/client")]);
  const store = new PgStore();
  const firmId = await store.sampleFirmId().catch(() => null);
  return { store, ledger: audit as Ledger, rest: paypalRest as Rest, now: () => new Date(), firm: { id: firmId, name: SAMPLE_FIRM_NAME } };
}

export async function resolveDeps(partial: Partial<PaymentsDeps> = {}): Promise<PaymentsDeps> {
  if (partial.store && partial.ledger && partial.rest) {
    return { store: partial.store, ledger: partial.ledger, rest: partial.rest, now: partial.now ?? (() => new Date()), firm: partial.firm ?? { id: null, name: SAMPLE_FIRM_NAME } };
  }
  defaults ??= loadDefaults();
  const d = await defaults;
  return { ...d, ...partial };
}

/** An in-memory ledger for tests and dry runs: the same calls as `audit`, kept in an array. */
export function memoryLedger() {
  const events: { actor: string; action: string; ref: string; detail: Record<string, unknown> }[] = [];
  const ledger: Ledger = async (actor, action, ref, detail = {}) => {
    events.push({ actor, action, ref, detail });
    return String(events.length);
  };
  return { ledger, events };
}

export const toCents = (dollars: number | string) => Math.round(Number(dollars) * 100);
export const toValue = (cents: number) => (cents / 100).toFixed(2);
export const usd = (cents: number) => `$${toValue(cents)}`;
