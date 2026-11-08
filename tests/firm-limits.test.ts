import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoPayVerdict, limitRules, limitVerdict, visitorHash } from "@/lib/firm/limits";
import { memoryLedger, type PaymentsDeps } from "@/lib/payments/deps";
import { FakePayPal } from "@/lib/payments/fake-paypal";
import { executePlan, planPayment, type ClaimForPayment } from "@/lib/payments/router";
import { MemoryStore } from "@/lib/payments/store";
import type { Rest } from "@/lib/payments/types";
import { restFor, verifyCredentials } from "@/lib/paypal/firm-account";

/**
 * One person, many claims: the limit counts every identity a claim carries, so a new email alone does not reset it;
 * the auto rule pays at most the firm's daily limit; and a firm's own PayPal app carries its refunds and payouts.
 */
const NOW = new Date("2026-11-07T18:00:00Z");
const none = { payee: 0, purchase: 0, payer: 0, device: 0 };

describe("the claim limit counts every identity, not one email", () => {
  it("passes a first claim, and names what a second one shares", () => {
    expect(limitVerdict(none).over).toBe(false);
    const sameEmail = limitVerdict({ ...none, payee: 1 }, "Brightline Home");
    expect(sameEmail.over).toBe(true);
    expect(sameEmail.plain).toBe("An earlier claim on this recall shares the email or phone the refund goes to, so a person at Brightline Home will check this one.");
  });

  it("a new email from the same network and browser still goes to a person", () => {
    // The second claim gives a payee nobody used before (payee 0), but it came from the same device as the first.
    const v = limitVerdict({ payee: 0, purchase: 0, payer: 0, device: 1 });
    expect(v.over).toBe(true);
    expect(v.matched).toEqual(["device"]);
    expect(v.plain).toContain("the same network and browser");
  });

  it("a new email on the same PayPal purchase, or paid by the same PayPal account, still goes to a person", () => {
    expect(limitVerdict({ ...none, purchase: 1 }).matched).toEqual(["purchase"]);
    const v = limitVerdict({ ...none, payer: 2, device: 1 });
    expect(v.matched).toEqual(["payer", "device"]);
    expect(v.plain).toContain("the PayPal account that paid for the purchase and the same network and browser");
    expect(v.technical).toBe("Claim limit: earlier claims on this recall matched by payer (2), device (1).");
  });

  it("hashes the network and device signal with the server secret, never keeping the address", () => {
    const a = visitorHash("203.0.113.7", "Mozilla/5.0 (iPhone)", "secret-a");
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).toBe(visitorHash("203.0.113.7", "Mozilla/5.0 (iPhone)", "secret-a"));
    expect(a).not.toBe(visitorHash("203.0.113.8", "Mozilla/5.0 (iPhone)", "secret-a"));
    expect(a).not.toBe(visitorHash("203.0.113.7", "Mozilla/5.0 (iPhone)", "secret-b"));
    expect(a).not.toContain("203");
    expect(visitorHash("", "", "s")).toBeNull();
  });

  it("states the same limits /evidence shows as the sample firm's seeded settings", async () => {
    const { SAMPLE_FIRM } = await import("../scripts/seed");
    const { DEFAULT_TERMS } = await import("@/app/api/claims/_lib/terms");
    expect(DEFAULT_TERMS.autoCapCents).toBe(SAMPLE_FIRM.settings.autoApproveCap * 100);
    expect(DEFAULT_TERMS.autoDailyCents).toBe(SAMPLE_FIRM.settings.dailyPayoutCap * 100);
  });

  it("states the rules from the firm's own settings", () => {
    const rules = limitRules({ autoCapCents: 5000, autoDailyCents: 35_000 });
    expect(rules.map((r) => r.title)).toEqual(["One refund per person per recall", "Paid with no person, up to a limit", "Only hashes are compared"]);
    expect(rules[0].rule).toContain("A new email address alone does not reset it.");
    expect(rules[1].rule).toContain("$50.00");
    expect(rules[1].rule).toContain("$350.00 a day");
  });
});

describe("the firm's daily auto-pay limit", () => {
  const claim = (over: Partial<ClaimForPayment> = {}): ClaimForPayment => ({
    claimId: "c-daily",
    recallNumber: "BH-2026-01",
    recallTitle: "Brightline 65W laptop charger",
    decision: "verified",
    amountCents: 3499,
    payee: { type: "email", value: "owner@example.com" },
    choice: "money",
    ...over,
  });
  const deps = (): Partial<PaymentsDeps> => ({ store: new MemoryStore(), ledger: memoryLedger().ledger, rest: new FakePayPal().rest, now: () => NOW, firm: { id: "1", name: "Brightline Home (sample)" } });

  it("pays with no person while today's auto-paid total stays within the limit", () => {
    expect(autoPayVerdict({ amountCents: 3499, paidTodayCents: 31_491, capCents: 35_000 }).ok).toBe(true);
    expect(autoPayVerdict({ amountCents: 3499, paidTodayCents: 31_502, capCents: 35_000 })).toMatchObject({ ok: false, plain: "The firm's auto-pay limit of $350.00 a day is reached, so a person approves this one." });
  });

  it("sends the rest of the day's verified claims to a person, and still pays the ones within it", async () => {
    const within = await planPayment(claim(), { autoCapCents: 5000, autoDaily: { capCents: 35_000, paidTodayCents: 0 } }, deps());
    expect(within.ok && within.plan.status).toBe("approved");
    const past = await planPayment(claim({ claimId: "c-daily-2" }), { autoCapCents: 5000, autoDaily: { capCents: 35_000, paidTodayCents: 33_000 } }, deps());
    expect(past.ok && past.plan.status).toBe("awaiting_approval");
    expect(past.ok && past.plan.reasons.plain).toContain("auto-pay limit of $350.00 a day");
    expect(past.ok && past.plan.approval).toBeNull();
  });
});

describe("a firm's own PayPal app", () => {
  type Call = { url: string; auth: string | null };
  function fakeFetch(accept: { id: string; secret: string }) {
    const calls: Call[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization");
      calls.push({ url, auth });
      if (url.endsWith("/v1/oauth2/token")) {
        const ok = auth === "Basic " + Buffer.from(`${accept.id}:${accept.secret}`).toString("base64");
        return new Response(JSON.stringify(ok ? { access_token: "firm-token", expires_in: 3600, app_id: "APP-FIRM", scope: "a b c" } : { error: "invalid_client" }), { status: ok ? 200 : 401 });
      }
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: "FIRMBATCH1", batch_status: "PENDING" } }), { status: 201, headers: { "paypal-debug-id": "dbg-firm" } });
    }) as typeof fetch;
    return { f, calls };
  }
  const ID = "AFirmClientId_0123456789abcd";
  const SECRET = "EFirmSecret_0123456789abcdefgh";

  it("checks the pair with PayPal before anything is stored", async () => {
    const { f } = fakeFetch({ id: ID, secret: SECRET });
    expect(await verifyCredentials({ clientId: ID, secret: SECRET }, f)).toEqual({ ok: true, appId: "APP-FIRM", scopes: 3 });
    expect(await verifyCredentials({ clientId: ID, secret: "EWrongSecret_0123456789abcdefgh" }, f)).toMatchObject({ ok: false });
    expect(await verifyCredentials({ clientId: "short", secret: SECRET }, f)).toMatchObject({ ok: false, plain: expect.stringContaining("does not look like") });
  });

  it("calls PayPal with the firm's own token, not the platform's", async () => {
    const { f, calls } = fakeFetch({ id: ID, secret: SECRET });
    const rest = restFor({ clientId: ID, secret: SECRET }, f);
    const r = await rest<{ batch_header: { payout_batch_id: string } }>("/v1/payments/payouts", { method: "POST", body: "{}" });
    expect(r.body.batch_header.payout_batch_id).toBe("FIRMBATCH1");
    expect(calls.find((c) => c.url.endsWith("/v1/payments/payouts"))?.auth).toBe("Bearer firm-token");
  });

  it("pays a firm's claim on the firm's own app when it connected one, and on the platform's otherwise", async () => {
    const platform = new FakePayPal();
    const firmPaypal = new FakePayPal();
    const seen: (string | null)[] = [];
    const restForFirm = async (firmId: string | null): Promise<Rest | null> => {
      seen.push(firmId);
      return firmId === "7" ? firmPaypal.rest : null;
    };
    for (const [firmId, pp] of [["7", firmPaypal], ["1", platform]] as const) {
      const d: Partial<PaymentsDeps> = { store: new MemoryStore(), ledger: memoryLedger().ledger, rest: platform.rest, now: () => NOW, firm: { id: firmId, name: "A firm" }, restFor: restForFirm };
      const p = await planPayment({ claimId: `c-${firmId}`, recallNumber: "BH-2026-01", recallTitle: "Charger", firmId, decision: "verified", amountCents: 3499, payee: { type: "email", value: "owner@example.com" }, choice: "money" }, { autoCapCents: 5000 }, d);
      expect(p.ok).toBe(true);
      const before = pp.calls.length;
      await executePlan(p.ok ? p.plan.id : "", d);
      expect(pp.calls.length).toBeGreaterThan(before);
    }
    expect(seen).toEqual(["7", "1"]);
    expect(platform.calls.some((c) => c.path.includes("/v1/payments/payouts"))).toBe(true);
    expect(firmPaypal.calls.some((c) => c.path.includes("/v1/payments/payouts"))).toBe(true);
  });
});

const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("on Postgres: identities and the firm's own app", async () => {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { autoPaidToday, identityMatches } = await import("@/app/api/claims/_lib/claims");
  const { accountView, connectAccount, credentialsFor, disconnectAccount } = await import("@/lib/paypal/firm-account");
  const tag = `limtest-${Date.now().toString(36)}`;
  let recall = "";
  let firmId = 0;
  let sampleFirm = 0;
  const made: string[] = [];

  beforeAll(async () => {
    const r = await db().execute(sql`select number from recall order by number desc limit 1`);
    recall = String(r.rows[0].number);
    const f = await db().execute(sql`insert into firm (slug, name, is_sample) values (${tag}, ${`Test firm ${tag}`}, false) returning id`);
    firmId = Number(f.rows[0].id);
    const s = await db().execute(sql`select id from firm where is_sample order by id limit 1`);
    sampleFirm = Number(s.rows[0]?.id ?? 0);
    // One earlier, real (not sample) claim on this recall: payee A, from device D.
    const c = await db().execute(sql`insert into claim (recall_number, firm_id, payee_type, payee_hash, payee_masked, visitor_hash, decision, status, amount, channel, is_sample)
      values (${recall}, ${firmId}, 'email', ${`${tag}-payee-a`}, ${tag}, ${`${tag}-device-d`}, 'verified', 'paid', 34.99, 'web', false) returning id`);
    made.push(String(c.rows[0].id));
  });

  afterAll(async () => {
    for (const id of made) {
      await db().execute(sql`delete from payment_plan where claim_id = ${id}::uuid`);
      await db().execute(sql`delete from claim where id = ${id}::uuid`);
    }
    await db().execute(sql`delete from firm where id = ${firmId}`);
  });

  const blank = { payeeHash: null, payeeAsBuyer: null, saleId: null, payerHash: null, visitorHash: null };
  const other = "00000000-0000-0000-0000-000000000000";

  it("a new email from the same device matches the earlier claim by device", async () => {
    expect(await identityMatches(recall, other, { ...blank, payeeHash: `${tag}-payee-new`, visitorHash: `${tag}-device-d` })).toEqual({ payee: 0, purchase: 0, payer: 0, device: 1 });
  });

  it("the same email from a new device matches by payee, and a stranger matches nothing", async () => {
    expect(await identityMatches(recall, other, { ...blank, payeeHash: `${tag}-payee-a`, visitorHash: `${tag}-device-new` })).toMatchObject({ payee: 1, device: 0 });
    expect(await identityMatches(recall, other, { ...blank, payeeHash: `${tag}-payee-b`, visitorHash: `${tag}-device-e` })).toEqual({ payee: 0, purchase: 0, payer: 0, device: 0 });
  });

  it("does not count the claim against itself", async () => {
    expect(await identityMatches(recall, made[0], { ...blank, payeeHash: `${tag}-payee-a`, visitorHash: `${tag}-device-d` })).toEqual({ payee: 0, purchase: 0, payer: 0, device: 0 });
  });

  it("the daily auto-pay total counts real auto-paid claims and leaves out seeded sample claims", async () => {
    const before = await autoPaidToday(firmId, recall);
    const real = await db().execute(sql`insert into claim (recall_number, firm_id, payee_type, payee_hash, payee_masked, decision, status, amount, channel, is_sample)
      values (${recall}, ${firmId}, 'email', ${`${tag}-payee-r`}, ${tag}, 'verified', 'paid', 34.99, 'web', false) returning id`);
    const sample = await db().execute(sql`insert into claim (recall_number, firm_id, payee_type, payee_hash, payee_masked, decision, status, amount, channel, is_sample)
      values (${recall}, ${firmId}, 'email', ${`${tag}-payee-s`}, ${tag}, 'verified', 'paid', 34.99, 'web', true) returning id`);
    made.push(String(real.rows[0].id), String(sample.rows[0].id));
    for (const id of [real.rows[0].id, sample.rows[0].id]) {
      await db().execute(sql`insert into payment_plan (claim_id, route, amount, approval, status) values (${String(id)}::uuid, 'payout', 34.99, 'auto', 'done')`);
    }
    expect((await autoPaidToday(firmId, recall)) - before).toBe(3499);
  });

  it("stores a firm's own PayPal app sealed, shows only its last four, and removes it on disconnect", async () => {
    const ok = (async () => new Response(JSON.stringify({ access_token: "t", expires_in: 3600, app_id: "APP-1", scope: "x" }), { status: 200 })) as unknown as typeof fetch;
    const id = "AFirmClientId_0123456789WXYZ";
    const r = await connectAccount(firmId, { clientId: id, secret: "EFirmSecret_0123456789abcdefgh" }, ok, new Date("2026-11-07T18:00:00Z"));
    expect(r).toMatchObject({ ok: true, stored: true, view: { mode: "own", clientIdTail: "WXYZ" } });
    const row = (await db().execute(sql`select paypal_client_id_enc, paypal_secret_enc from firm where id = ${firmId}`)).rows[0] as { paypal_client_id_enc: string; paypal_secret_enc: string };
    expect(row.paypal_client_id_enc).not.toContain("AFirm");
    expect(row.paypal_secret_enc).not.toContain("EFirm");
    expect(await credentialsFor(firmId)).toEqual({ clientId: id, secret: "EFirmSecret_0123456789abcdefgh" });
    expect(JSON.stringify(await accountView(firmId))).not.toContain("EFirm");
    expect((await disconnectAccount(firmId)).mode).toBe("platform");
    expect(await credentialsFor(firmId)).toBeNull();
  });

  it("checks but never stores credentials on the sample firm, whose console is open to everyone", async () => {
    if (!sampleFirm) return;
    const ok = (async () => new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch;
    const r = await connectAccount(sampleFirm, { clientId: "AFirmClientId_0123456789WXYZ", secret: "EFirmSecret_0123456789abcdefgh" }, ok);
    expect(r).toMatchObject({ ok: true, stored: false, view: { mode: "platform" } });
    expect(await credentialsFor(sampleFirm)).toBeNull();
  });
});
