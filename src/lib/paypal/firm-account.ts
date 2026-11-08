/**
 * Whose money is it: each firm can pay its refunds from its own PayPal account.
 *
 * PayPal's Partner Referrals API (POST /v2/customer/partner-referrals), which would let a platform onboard firms and
 * act for them with PayPal-Auth-Assertion, needs an app PayPal has approved as a partner: Remedy's sandbox app gets
 * NOT_AUTHORIZED (HTTP 403, tried 2026-11-07). So a firm connects its own PayPal REST app instead: its client ID and
 * secret are checked against PayPal (an OAuth token request), sealed with AES-256-GCM (src/lib/secure.ts) and never
 * shown again, only the last four characters of the client ID. That firm's refunds and payouts then run on its own
 * credentials; a firm with none, like the sample firm Brightline Home, pays from the platform's sandbox account.
 *
 * The sample firm's console is open to every visitor, so for it the credentials are checked and never stored.
 * Server only.
 */
import { Client, Environment, OrdersController, PaymentsController } from "@paypal/paypal-server-sdk";
import { eq } from "drizzle-orm";
import { db, dbConfigured, schema } from "@/lib/db";
import type { Rest } from "@/lib/payments/types";
import { decrypt, encrypt } from "@/lib/secure";
import { makeSdkRest } from "./sdk-rest";

export const PAYPAL_API = "https://api-m.sandbox.paypal.com";

export type Credentials = { clientId: string; secret: string };
export type AccountView =
  | { mode: "own"; clientIdTail: string; connectedAt: string; verifiedAt: string; env: "sandbox" }
  | { mode: "platform"; note: string };

type Fetch = typeof fetch;

/** A client ID or secret as PayPal issues them: 20 to 100 letters, digits, dashes and underscores. */
const looksLikeKey = (v: string) => /^[A-Za-z0-9_-]{20,100}$/.test(v);

/** Check the credentials with PayPal: an OAuth client-credentials token request, the same one every call starts with. */
export async function verifyCredentials(c: Credentials, f: Fetch = fetch): Promise<{ ok: true; appId: string | null; scopes: number } | { ok: false; plain: string }> {
  const clientId = c.clientId.trim();
  const secret = c.secret.trim();
  if (!looksLikeKey(clientId) || !looksLikeKey(secret)) return { ok: false, plain: "That does not look like a PayPal client ID and secret. Copy both from your app in the PayPal developer dashboard." };
  try {
    const res = await f(`${PAYPAL_API}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) return { ok: false, plain: "PayPal did not accept that client ID and secret. Check that both are from the same sandbox app." };
    if (!res.ok) return { ok: false, plain: `PayPal did not answer as expected (${res.status}). Please try again.` };
    const j = (await res.json()) as { app_id?: string; scope?: string };
    return { ok: true, appId: j.app_id ?? null, scopes: (j.scope ?? "").split(" ").filter(Boolean).length };
  } catch {
    return { ok: false, plain: "PayPal could not be reached just now. Please try again." };
  }
}

/** REST access to PayPal on one firm's own credentials: Payouts and Disputes on REST, Orders and Payments on the SDK. */
export function restFor(c: Credentials, f: Fetch = fetch): Rest {
  let token: { value: string; exp: number } | null = null;
  const accessToken = async () => {
    if (token && token.exp > Date.now() + 5 * 60_000) return token.value;
    const res = await f(`${PAYPAL_API}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${c.clientId}:${c.secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal token request for the firm's own app failed (${res.status})`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return token.value;
  };
  const rest = (async <T>(path: string, init: RequestInit & { requestId?: string } = {}) => {
    const t = await accessToken();
    const res = await f(`${PAYPAL_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}), ...((init.headers as Record<string, string>) ?? {}) },
    });
    const body = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body, debugId: res.headers.get("paypal-debug-id") };
  }) as Rest;
  // In tests the fetch is replaced, so the SDK (which has its own HTTP client) stays out of the way.
  if (f !== fetch) return rest;
  const client = new Client({ clientCredentialsAuthCredentials: { oAuthClientId: c.clientId, oAuthClientSecret: c.secret }, timeout: 0, environment: Environment.Sandbox });
  return makeSdkRest({ orders: () => new OrdersController(client), payments: () => new PaymentsController(client) }, rest) as Rest;
}

const tail = (id: string) => id.slice(-4);

/** The firm's PayPal account as the console shows it. Never returns a secret or a full client ID. */
export async function accountView(firmId: number): Promise<AccountView> {
  const platform: AccountView = { mode: "platform", note: "Refunds and payouts are paid from Remedy's PayPal sandbox account." };
  if (!dbConfigured()) return platform;
  const [f] = await db().select().from(schema.firms).where(eq(schema.firms.id, firmId)).limit(1);
  const p = (f?.settings as { paypal?: { clientIdTail?: string; connectedAt?: string; verifiedAt?: string } } | undefined)?.paypal;
  if (!f?.paypalClientIdEnc || !f.paypalSecretEnc || !p?.clientIdTail) return platform;
  return { mode: "own", clientIdTail: p.clientIdTail, connectedAt: p.connectedAt ?? "", verifiedAt: p.verifiedAt ?? "", env: "sandbox" };
}

/** The firm's own credentials, when it has connected them; null pays from the platform account. */
export async function credentialsFor(firmId: number | string | null | undefined): Promise<Credentials | null> {
  const id = Number(firmId);
  if (!dbConfigured() || !Number.isInteger(id) || id <= 0) return null;
  const [f] = await db().select({ c: schema.firms.paypalClientIdEnc, s: schema.firms.paypalSecretEnc }).from(schema.firms).where(eq(schema.firms.id, id)).limit(1);
  if (!f?.c || !f.s) return null;
  return { clientId: decrypt(f.c), secret: decrypt(f.s) };
}

/** The Rest a firm's payments run on: its own app when connected, else null (the caller keeps the platform's). */
export async function restForFirm(firmId: number | string | null | undefined): Promise<Rest | null> {
  const c = await credentialsFor(firmId);
  return c ? restFor(c) : null;
}

export type ConnectResult = { ok: true; stored: boolean; view: AccountView; plain: string } | { ok: false; plain: string };

/**
 * Connect a firm's own PayPal REST app. The credentials are checked with PayPal first; a sample firm's are checked and
 * not stored, since its console is open to every visitor.
 */
export async function connectAccount(firmId: number, c: Credentials, f: Fetch = fetch, now = new Date()): Promise<ConnectResult> {
  const v = await verifyCredentials(c, f);
  if (!v.ok) return v;
  const [firm] = await db().select().from(schema.firms).where(eq(schema.firms.id, firmId)).limit(1);
  if (!firm) return { ok: false, plain: "There is no firm with that id." };
  if (firm.isSample) {
    return {
      ok: true,
      stored: false,
      view: await accountView(firmId),
      plain: `PayPal accepted these credentials. ${firm.name.replace(/\s*\(sample\)\s*$/i, "")} is the sample firm and its console is open to everyone, so they were not stored and it keeps paying from the platform's sandbox account. A firm's own console stores them sealed and pays from them.`,
    };
  }
  const settings = { ...(firm.settings ?? {}), paypal: { clientIdTail: tail(c.clientId.trim()), connectedAt: now.toISOString(), verifiedAt: now.toISOString(), appId: v.appId } };
  await db().update(schema.firms).set({ paypalClientIdEnc: encrypt(c.clientId.trim()), paypalSecretEnc: encrypt(c.secret.trim()), settings }).where(eq(schema.firms.id, firmId));
  return { ok: true, stored: true, view: await accountView(firmId), plain: `Connected. Refunds and payouts for ${firm.name} now run on your PayPal app ending ${tail(c.clientId.trim())}.` };
}

/** Disconnect: the sealed credentials are deleted and the firm pays from the platform account again. */
export async function disconnectAccount(firmId: number): Promise<AccountView> {
  const [firm] = await db().select().from(schema.firms).where(eq(schema.firms.id, firmId)).limit(1);
  if (!firm) return { mode: "platform", note: "" };
  const { paypal: _gone, ...rest } = (firm.settings ?? {}) as Record<string, unknown>;
  void _gone;
  await db().update(schema.firms).set({ paypalClientIdEnc: null, paypalSecretEnc: null, settings: rest }).where(eq(schema.firms.id, firmId));
  return accountView(firmId);
}
