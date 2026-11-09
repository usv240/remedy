import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claimNote, SAMPLE_PAYPAL_STATUS } from "@/lib/firm/queue";
import {
  READY_AMOUNT,
  READY_TARGET,
  readyPayee,
  SAMPLE_PHOTO_WHAT,
  SAMPLE_PLAN,
  sampleChecks,
  sampleDebate,
  sampleDecision,
  samplePhotoFor,
  sampleResult,
  sampleRunFor,
  type SampleKind,
} from "@/lib/firm/sample-claims";
import { buildSampleRuns } from "../scripts/verify/sample-claim-runs";

/**
 * The sample claims the firm console shows. Every score, decision and reviewer vote a seeded claim carries is read from a
 * recorded run (content/presets/recorded/sample-charger-cut.json, content/verify/sweep-sample.json), and each claim's
 * drawer caption describes its own photo. Two claims are kept ready to pay at the recall's $34.99 refund, to a PayPal
 * sandbox personal account, marked sample, with no model call. The Postgres part (skipped without DATABASE_URL) tops
 * them up twice at once and checks that the advisory lock keeps it to the target.
 */
const ROOT = process.cwd();
const json = <T>(...p: string[]) => JSON.parse(readFileSync(path.join(ROOT, ...p), "utf8")) as T;
const PRESET = json<{ recorded_at: string; decision: string; decided_by: string; vision: { report: { product: { match_score: number }; photo_source: { confidence: number } } } }>("content", "presets", "recorded", "sample-charger-cut.json");
const SWEEP = json<{ configs: { id: string }[]; cases: { config: string; trial: number; case: string; decision: string; decided_by: string; C1: number; C1_status: string; C2: string; C3: string; C4: string; C3_reason: string }[] }>("content", "verify", "sweep-sample.json");
const CASE_OF: Record<string, string> = { made_safe: "sample-charger-cut", opened: "sample-charger-opened-cord-attached", opened_case: "sample-charger-opened-case" };

/** Every sample claim the seed writes: each kind of the plan, the k-th of that kind, and the two kept ready to pay. */
const SEEDED: { kind: SampleKind; k: number }[] = [...SAMPLE_PLAN.flatMap((p) => p.at.map((_, k) => ({ kind: p.kind, k }))), ...Array.from({ length: READY_TARGET }, (_, k) => ({ kind: "paid" as const, k }))];

describe("sample claims show recorded runs only", () => {
  it("every seeded score, status and decision is the one its recording holds", () => {
    expect(SEEDED.length).toBeGreaterThan(30);
    for (const { kind, k } of SEEDED) {
      const run = sampleRunFor(kind, k);
      const checks = sampleChecks(kind, k);
      const label = `${kind} #${k} (${run.id})`;
      expect(run.decision, label).toBe(sampleDecision(kind));
      // Only the two judgements a model makes carry a score: the product match (C1) and the photo's source (C3).
      for (const id of ["C2", "C4", "C5", "C6"] as const) expect(checks[id].score, `${label} ${id}`).toBeUndefined();
      if (run.from.file === "content/presets/recorded/sample-charger-cut.json") {
        expect(checks.C1.score, label).toBe(Math.round(PRESET.vision.report.product.match_score * 100) / 100);
        expect(checks.C3.score, label).toBe(PRESET.vision.report.photo_source.confidence);
        expect([run.decision, run.decidedBy], label).toEqual([PRESET.decision, PRESET.decided_by]);
        expect(run.from.recordedAt).toBe(PRESET.recorded_at);
      } else {
        expect(run.from.file, label).toBe("content/verify/sweep-sample.json");
        const row = SWEEP.cases.find((c) => c.config === SWEEP.configs[0].id && c.case === CASE_OF[run.photo] && c.trial === run.from.trial);
        expect(row, label).toBeDefined();
        expect(checks.C1.score, label).toBe(row!.C1);
        expect(checks.C3.score, label).toBe(Number(/confidence ([\d.]+)/.exec(row!.C3_reason)![1]));
        expect([checks.C1.status, checks.C2.status, checks.C3.status, checks.C4.status], label).toEqual([row!.C1_status, row!.C2, row!.C3, row!.C4]);
        expect([run.decision, run.decidedBy], label).toEqual([row!.decision, row!.decided_by]);
      }
      // A claim never carries a random score again: the same claim gives the same checks every time.
      expect(sampleChecks(kind, k)).toEqual(checks);
      // The reviewers' votes are shown only where the recording kept them.
      expect(sampleDebate(kind, k) === null, label).toBe(run.review === null);
    }
  });

  it("the committed runs are what the recordings give, replayed with no model call", async () => {
    const built = await buildSampleRuns();
    expect(json("src", "lib", "firm", "samples", "claim-runs.json")).toEqual(JSON.parse(JSON.stringify(built)));
  });

  it("on a recall with no recording, a sample claim shows no score at all", () => {
    for (const { kind, k } of SEEDED) for (const c of Object.values(sampleChecks(kind, k, "27056"))) expect(c.score).toBeUndefined();
  });
});

describe("each sample claim's drawer caption describes its own photo", () => {
  it("names the photo the claim carries, and the CPSC example only for the claim that carries it", () => {
    for (const { kind, k } of SEEDED) {
      const result = sampleResult(kind, k);
      const paid = kind === "paid" || kind === "unclaimed" || kind === "reviewed_paid";
      const note = claimNote({ is_sample: true, paypal_status: paid && k < 100 ? SAMPLE_PAYPAL_STATUS : null, decision: sampleDecision(kind), amount: READY_AMOUNT, photo_id: "photo" }, result)!;
      expect(note, `${kind} #${k}`).toContain(SAMPLE_PHOTO_WHAT[samplePhotoFor(kind, k)]);
      expect(note).toContain("Dmitry G, Wikimedia Commons, public domain");
      expect(note).toContain(result.recorded!.file);
      expect(note).not.toMatch(/26125|hair dryer/);
    }
    // The one claim photographed from the CPSC's example (recall 26125) says so; a claim with no stored caption says nothing about a photo.
    const lookAlike = claimNote(
      { is_sample: true, paypal_status: null, decision: "firm_review", amount: "20.00", photo_id: "photo" },
      { photo: { what: "the CPSC's own made-safe example for recall 26125 (a different hair dryer)", credit: "US Consumer Product Safety Commission, public domain" }, recorded: { file: "src/lib/firm/samples/look-alike.json", recordedAt: "2026-11-06T12:00:00Z", live: true } },
    )!;
    expect(lookAlike).toMatch(/recall 26125 \(a different hair dryer\), checked live once against this recall by Claude on November 6, 2026/);
    const legacy = claimNote({ is_sample: true, paypal_status: SAMPLE_PAYPAL_STATUS, decision: "verified", amount: "34.99", photo_id: "photo" }, { decided_by: "checks" });
    expect(legacy).toBe("Sample history (not paid). Seeded so the console is not empty; no money moved for this claim.");
    expect(claimNote({ is_sample: false, paypal_status: null, decision: "verified", amount: "34.99", photo_id: "photo" }, null)).toBeNull();
  });
});

describe("sample claims ready to pay", () => {
  it("pay the recall's refund, are verified as recorded, and say they are samples", () => {
    expect(READY_TARGET).toBeGreaterThanOrEqual(2);
    // The recall's real refund, inside the demo's $50 payment limit (src/lib/payments/router.ts).
    expect(READY_AMOUNT).toBe("34.99");
    expect(Number(READY_AMOUNT)).toBeLessThan(50);
    expect(samplePhotoFor("paid", 0)).toBe("made_safe");
    expect(sampleResult("paid", 0)).toMatchObject({ decided_by: "reviewers", sample: true, model: "claude-opus-5-5", photo: { kind: "made_safe" } });
  });

  it("pay the sandbox buyer: SANDBOX_BUYER_EMAIL, or else the sandbox login TESTING.md publishes", async () => {
    const was = process.env.SANDBOX_BUYER_EMAIL;
    try {
      delete process.env.SANDBOX_BUYER_EMAIL;
      expect(await readyPayee()).toMatch(/@personal\.example\.com$/);
      process.env.SANDBOX_BUYER_EMAIL = "buyer@personal.example.com";
      expect(await readyPayee()).toBe("buyer@personal.example.com");
    } finally {
      if (was === undefined) delete process.env.SANDBOX_BUYER_EMAIL;
      else process.env.SANDBOX_BUYER_EMAIL = was;
    }
  });
});

describe.skipIf(!process.env.DATABASE_URL)("sample claims ready to pay, on Postgres", async () => {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { ensureReadyClaims } = await import("@/lib/firm/sample-claims");
  const { sampleFirm, SAMPLE_RECALL } = await import("@/lib/firm/firm");

  it("tops up to the target and no further, even when two requests ask at once", async () => {
    const firm = await sampleFirm();
    if (!firm) return;
    await Promise.all([ensureReadyClaims(firm.id, SAMPLE_RECALL), ensureReadyClaims(firm.id, SAMPLE_RECALL)]);
    const count = async () =>
      ((await db().execute(sql`
        select count(*)::int as n from claim c where c.firm_id = ${firm.id} and c.is_sample and c.decision = 'verified' and c.status = 'verified'
          and c.review_outcome is null and c.payee_value_enc is not null and c.amount > 0
          and not exists (select 1 from payment p where p.claim_id = c.id) and not exists (select 1 from payment_plan pp where pp.claim_id = c.id)`)).rows[0] as { n: number }).n;
    const n = await count();
    expect(n).toBeGreaterThanOrEqual(READY_TARGET);
    const again = await Promise.all([ensureReadyClaims(firm.id, SAMPLE_RECALL), ensureReadyClaims(firm.id, SAMPLE_RECALL)]);
    expect(again).toEqual([0, 0]);
    expect(await count()).toBe(n);
  });
});
