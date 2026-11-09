import { paypalApiOf } from "@/lib/paypal/sdk-rest";
import type { PaymentStore } from "./store";
import type { Ledger, PayPalApi, Rest } from "./types";

/**
 * What every payments function needs: a store, the ledger, PayPal access and a clock. Production code passes nothing
 * and gets Postgres, the hash-chained ledger, the PayPal Server SDK for Orders and Payments and REST for the rest.
 * Tests pass a MemoryStore, an in-memory ledger and a fake `rest`, so no network or database is touched; their
 * `paypal` is the same six calls over that fake. Defaults load lazily so tests never import them.
 */
export type PaymentsDeps = {
  store: PaymentStore;
  ledger: Ledger;
  /** REST, for what the SDK does not cover: Payouts, Transaction Search, Disputes, webhook verification. */
  rest: Rest;
  /** Orders and Payments: the SDK's own methods in production (src/lib/paypal/sdk-rest.ts). */
  paypal: PayPalApi;
  now: () => Date;
  /** The firm the money comes from. In this build, the sample firm's sandbox account. */
  firm: { id: string | null; name: string };
  /**
   * A firm's own PayPal app, when it has connected one (src/lib/paypal/firm-account.ts): refunds and payouts for its
   * claims run on it. Null or absent pays from `rest`, the platform's sandbox account.
   */
  restFor?: (firmId: string | null) => Promise<Rest | null>;
  /**
   * Read an order through PayPal's own MCP server (get_order, read only; src/lib/paypal/mcp.ts). Check C6 asks it first
   * and reads the Orders API when it answers null. Absent in tests unless a mock is passed.
   */
  orderViaMcp?: (orderId: string) => Promise<{ via: "mcp"; body: Record<string, unknown> } | { via: null; why: string }>;
};

export const SAMPLE_FIRM_NAME = "Brightline Home (sample)";

/** Shown on every demo payout, refund and order. */
export const SANDBOX_LABEL = "Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm.";

/** Safety limits for the public sandbox demo. Every test payment stays under $50. */
export const LIMITS = { perPaymentCents: 5000, perDayCents: 50_000, bulkClaims: 50 } as const;

let defaults: Promise<PaymentsDeps> | null = null;

async function loadDefaults(): Promise<PaymentsDeps> {
  // Orders and Payments go through the APIMatic-generated PayPal Server SDK; Payouts and Transaction Search use REST.
  const [{ PgStore }, { audit }, { sdkApi }, client, { restForFirm }, mcp] = await Promise.all([
    import("./pg-store"),
    import("@/lib/audit"),
    import("@/lib/paypal/sdk-rest"),
    import("@/lib/paypal/client"),
    import("@/lib/paypal/firm-account"),
    import("@/lib/paypal/mcp"),
  ]);
  const store = new PgStore();
  const firmId = await store.sampleFirmId().catch(() => null);
  return {
    store,
    ledger: audit as Ledger,
    rest: client.paypalRest as Rest,
    paypal: sdkApi({ orders: client.orders, payments: client.payments }),
    now: () => new Date(),
    firm: { id: firmId, name: SAMPLE_FIRM_NAME },
    restFor: (id) => restForFirm(id),
    orderViaMcp: mcp.paypalMcpEnabled() ? (id) => mcp.readOrderViaMcp(id) : undefined,
  };
}

export async function resolveDeps(partial: Partial<PaymentsDeps> = {}): Promise<PaymentsDeps> {
  if (partial.store && partial.ledger && partial.rest) {
    return {
      store: partial.store,
      ledger: partial.ledger,
      rest: partial.rest,
      paypal: partial.paypal ?? paypalApiOf(partial.rest),
      now: partial.now ?? (() => new Date()),
      firm: partial.firm ?? { id: null, name: SAMPLE_FIRM_NAME },
      restFor: partial.restFor,
      orderViaMcp: partial.orderViaMcp,
    };
  }
  defaults ??= loadDefaults();
  const d = await defaults;
  // A caller that swaps the REST client alone (a dry run, a test seam) gets its Orders and Payments over the same client.
  const paypal = partial.paypal ?? (partial.rest ? paypalApiOf(partial.rest) : d.paypal);
  return { ...d, ...partial, paypal };
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
