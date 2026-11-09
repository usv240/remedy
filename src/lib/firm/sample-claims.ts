/**
 * The sample firm's sample claims: the check results and stored result a seeded claim carries (scripts/seed-firm.ts
 * writes the history with them), and the claims kept ready to pay so anyone can press Approve and pay in
 * /firm/claims and watch a real PayPal sandbox payout. Every row is marked sample (claim.is_sample). No model call and
 * no PayPal call happen here. Server only.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { storedCopy } from "@/lib/ops/photos";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { sandboxBuyerLogin } from "@/lib/sandbox-login";
import { encrypt, hashContact, maskContact } from "@/lib/secure";
import type { CheckId, CheckStatus, Checks } from "@/lib/verify/types";
import { SHOP } from "@/lib/payments/shop-catalog";
import { SAMPLE_RECALL } from "./firm";
import runsFile from "./samples/claim-runs.json";
import type { SampleRun, SampleRunsFile } from "./samples/types";

/**
 * How many sample claims are kept ready to pay, and what each pays: the recall's real refund, the sample charger's
 * $34.99. The sandbox payout balance was $4,261.32 on 2026-11-07 (GET /v1/reporting/balances), about 120 payouts at
 * that amount, and the demo's payment limit of $500 a day (src/lib/payments/router.ts) holds a day to 14 of them.
 */
export const READY_TARGET = 2;
export const READY_AMOUNT = (SHOP.product.priceCents / 100).toFixed(2);

export type SampleKind = "paid" | "unclaimed" | "review" | "reviewed_paid" | "retake" | "review_retake";

/**
 * The sample history scripts/seed-firm.ts writes, as fractions of the days since the announcement (0 is the
 * announcement day, 1 is today): paid claims spread over the whole time, three payouts not yet accepted, and the open
 * reviews and retakes in the last days. Exported so tests/sample-claims.test.ts checks every claim the seed writes.
 */
export const SAMPLE_PLAN: { kind: SampleKind; at: number[] }[] = [
  { kind: "paid", at: Array.from({ length: 23 }, (_, i) => (i / 23) * 0.95) },
  { kind: "unclaimed", at: [0.15, 0.45, 0.6] },
  { kind: "reviewed_paid", at: [0.3, 0.6] },
  { kind: "review_retake", at: [0.5] },
  { kind: "retake", at: [0.7, 0.8, 0.9, 0.97] },
  { kind: "review", at: [0.82, 0.88, 0.93, 0.96, 0.99] },
];

const NAMES: Record<CheckId, string> = { C1: "Right product", C2: "Made safe", C3: "Your own photo", C4: "Within the recall", C5: "Claim limits", C6: "Not already refunded" };

/** A check with no recording behind it: its status and plain words only, never a score. */
export function sampleCheck(id: CheckId, status: CheckStatus, plain: string) {
  return {
    id,
    name: NAMES[id],
    pass: status === "pass",
    status,
    reason_plain: plain,
    reason_technical: "Sample check result, seeded for the demo. No model call was made, and no score is shown because no recorded run stands behind it.",
  };
}

/**
 * The recorded runs the sample recall's claims carry (src/lib/firm/samples/claim-runs.json, written by
 * scripts/verify/sample-claim-runs.ts from content/presets/recorded/sample-charger-cut.json and
 * content/verify/sweep-sample.json). Every check, score, decision and reviewer vote a sample claim shows is one of them.
 */
export type SamplePhotoKind = SampleRun["photo"];
const RUNS = (runsFile as SampleRunsFile).runs;
const VERIFIED = RUNS.filter((r) => r.photo === "made_safe" && r.decision === "verified");
const REVIEWED = RUNS.filter((r) => r.photo === "made_safe" && r.decision === "firm_review");
const RETAKES = RUNS.filter((r) => r.photo !== "made_safe" && r.decision === "retake");

/** The recorded run a sample claim of this kind shows: the i-th claim of a kind takes the runs of that kind in turn. */
export function sampleRunFor(kind: SampleKind, i: number): SampleRun {
  const list = kind === "paid" || kind === "unclaimed" ? VERIFIED : kind === "retake" ? RETAKES : REVIEWED;
  if (!list.length) throw new Error(`No recorded run for sample claims of kind ${kind}: run scripts/verify/sample-claim-runs.ts.`);
  return list[Math.abs(i) % list.length];
}

/** The photo a sample claim carries: the photo of its recorded run. */
export const samplePhotoFor = (kind: SampleKind, i: number): SamplePhotoKind => sampleRunFor(kind, i).photo;

/**
 * The words the sample claims use for the main recall's product and its remedy. Brightline's own sample charger
 * recall (cut the cord) is the main recall; the power bank words stay for a database still on 27056, where no
 * recording exists, so its sample checks carry no score.
 */
type Words = { product: string; done: string; notYet: string; unclear: string; retake: string[] };
const WORDS: Record<string, Words> = {
  "BH-2026-01": {
    product: "Brightline 65W laptop charger",
    done: "The cord is cut where it meets the charger case.",
    notYet: "The cord is not cut yet.",
    unclear: "This looks like the recalled charger, but the case is hard to see in the photo.",
    retake: ["Cut the cord where it meets the charger case.", "Take one photo that shows the cut cord with the charger."],
  },
  "27056": {
    product: "HAIARA power bank",
    done: "The word recalled is written on the power bank in marker.",
    notYet: "The word recalled is not on the power bank yet.",
    unclear: "The power bank looks like the recalled one, but the model label is not readable in the photo.",
    retake: ["Write RECALLED on the power bank in permanent marker, in big letters.", "Take one photo that shows the whole power bank and the word."],
  },
};
export const sampleWords = (recall: string = SAMPLE_RECALL) => WORDS[recall] ?? WORDS["27056"];

/** Whether a recall's sample claims have recorded runs to show: only the sample charger recall does. */
export const hasRecordedRuns = (recall: string) => recall === "BH-2026-01";

/** The decision a sample claim of this kind was given. */
export const sampleDecision = (kind: SampleKind): "verified" | "retake" | "firm_review" => (kind === "paid" || kind === "unclaimed" ? "verified" : kind === "retake" ? "retake" : "firm_review");

/**
 * The six checks for a sample claim of this kind: the recorded run's checks on the sample recall; on any other recall,
 * the statuses alone, with no score, because no recorded run stands behind them.
 */
export function sampleChecks(kind: SampleKind, i: number, recall: string = SAMPLE_RECALL): Checks {
  if (hasRecordedRuns(recall)) return structuredClone(sampleRunFor(kind, i).checks) as unknown as Checks;
  const w = sampleWords(recall);
  const decision = sampleDecision(kind);
  return {
    C1: decision === "firm_review" ? sampleCheck("C1", "unclear", w.unclear) : sampleCheck("C1", "pass", `This is the recalled ${w.product}.`),
    C2: decision === "retake" ? sampleCheck("C2", "fail", w.notYet) : sampleCheck("C2", "pass", w.done),
    C3: sampleCheck("C3", "pass", "This is the owner's own photo, not the recall picture or a screen."),
    C4: sampleCheck("C4", "pass", "No model or lot number is needed for this recall."),
    C5: sampleCheck("C5", "pass", "One claim for one unit, within the limits."),
    C6: sampleCheck("C6", "pass", "No earlier refund for this purchase."),
  } as Checks;
}

/** The two reviewers' recorded votes for a sample claim, when its recorded run kept them. */
export function sampleDebate(kind: SampleKind, i: number, recall: string = SAMPLE_RECALL): unknown | null {
  return hasRecordedRuns(recall) ? (sampleRunFor(kind, i).review ?? null) : null;
}

/** The photo a sample claim carries, in words, with its credit: what the drawer's caption says. */
export const SAMPLE_PHOTO_WHAT: Record<SamplePhotoKind, string> = {
  made_safe: "the sample charger with its cord cut",
  opened: "the sample charger opened, its cord still attached",
  opened_case: "the sample charger taken apart, its cord still wired to the board",
};
export const SAMPLE_PHOTO_CREDIT = "Dmitry G, Wikimedia Commons, public domain";

/** claim.result for a sample claim, in the shape the claim route stores (src/app/api/claims/_lib/claims.ts). */
export function sampleResult(kind: SampleKind, i: number, recall: string = SAMPLE_RECALL) {
  const decision = sampleDecision(kind);
  const w = sampleWords(recall);
  const guidance = decision === "retake" ? { plain: `${w.retake[0].replace(/\.$/, "")}, then take the photo again.`, steps: w.retake, technical: "Sample guidance." } : null;
  if (!hasRecordedRuns(recall)) {
    const plain = decision === "verified" ? "All six checks pass." : decision === "retake" ? "The photo needs one more try." : "The checks were unsure, so a person at the firm will look.";
    return { decided_by: decision === "firm_review" ? "reviewers" : "checks", summary: { plain, technical: "Sample result, seeded for the demo. No model call was made." }, guidance, model: null, timings: null, sample: true };
  }
  const r = sampleRunFor(kind, i);
  return {
    decided_by: r.decidedBy,
    summary: r.summary,
    guidance,
    model: r.model,
    timings: null,
    sample: true,
    photo: { kind: r.photo, what: SAMPLE_PHOTO_WHAT[r.photo], credit: SAMPLE_PHOTO_CREDIT },
    recorded: { file: r.from.file, at: r.from.at, recordedAt: r.from.recordedAt, run: r.id },
  };
}

/**
 * Who the ready claims pay: the sandbox buyer, from SANDBOX_BUYER_EMAIL, or else the sandbox login TESTING.md
 * publishes for testers. Either way a PayPal sandbox personal account, so each payout reaches SUCCESS.
 */
export async function readyPayee(): Promise<string | null> {
  return process.env.SANDBOX_BUYER_EMAIL?.trim() || (await sandboxBuyerLogin())?.email || null;
}

/**
 * The photos the sample claims carry: the sample set's own public-domain photos of one charger (Dmitry G, Wikimedia
 * Commons; public/samples/charger/CREDITS.json), each the photo of the recorded run the claim shows. Each is one photo
 * row (source "preset", never pruned), shared by the sample claims that show it.
 */
const SAMPLE_PHOTO_FILES: Record<SamplePhotoKind, string> = {
  made_safe: "cord-cut.jpg",
  opened: "opened-cord-attached.jpg",
  opened_case: "opened-case.jpg",
};

/** The photo row for each sample photo, made once and found again by its SHA-256. */
export async function samplePhotoIds(): Promise<Partial<Record<SamplePhotoKind, string>>> {
  const out: Partial<Record<SamplePhotoKind, string>> = {};
  for (const [kind, file] of Object.entries(SAMPLE_PHOTO_FILES) as [SamplePhotoKind, string][]) {
    const p = [path.join(process.cwd(), "public", "samples", "charger", file), path.join(process.cwd(), "content", "verify", "fixtures", "sample", file)].find(existsSync);
    if (!p) continue;
    const bytes = readFileSync(p);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const [have] = (await db().execute(sql`select id from photo where sha256 = ${sha} and source = 'preset' and bytes is not null order by created_at limit 1`)).rows as { id: string }[];
    if (have) {
      out[kind] = have.id;
      continue;
    }
    const copy = await storedCopy(bytes);
    if (!copy) continue;
    const [row] = (await db().execute(sql`insert into photo (sha256, mime, size, width, height, bytes, source) values (${sha}, ${copy.mime}, ${bytes.length}, ${copy.width}, ${copy.height}, ${copy.bytes}, 'preset') returning id`)).rows as { id: string }[];
    out[kind] = row.id;
  }
  return out;
}

/** Sample claims of the firm that the queue shows as ready to pay: verified, not reviewed away, no plan, no payment. */
const READY_SQL = (firmId: number) => sql`
  select count(*)::int as n from claim c
  where c.firm_id = ${firmId} and c.is_sample and c.decision = 'verified' and c.status = 'verified' and c.review_outcome is null
    and c.payee_value_enc is not null and c.amount > 0
    and not exists (select 1 from payment p where p.claim_id = c.id)
    and not exists (select 1 from payment_plan pp where pp.claim_id = c.id)`;

/**
 * Keep at least READY_TARGET sample claims ready to pay, at READY_AMOUNT each. Called by scripts/seed-firm.ts at each
 * deploy, when the claims queue is read and after a batch is paid. Idempotent and safe to call at once from two
 * requests: a transaction-scoped advisory lock serializes the count and the insert. Returns how many it added.
 */
export async function ensureReadyClaims(firmId: number, recall: string = SAMPLE_RECALL, now = new Date()): Promise<number> {
  const payee = await readyPayee();
  if (!payee) return 0;
  const photo = recall === SAMPLE_RECALL ? ((await samplePhotoIds().catch(() => ({}) as Partial<Record<SamplePhotoKind, string>>)).made_safe ?? null) : null;
  const added = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ready-claims:${firmId}`}))`);
    const [{ n }] = (await tx.execute(READY_SQL(firmId))).rows as { n: number }[];
    if (n >= READY_TARGET) return 0;
    const [known] = (await tx.execute(sql`select 1 as ok from recall where number = ${recall}`)).rows;
    if (!known) return 0;
    for (let k = n; k < READY_TARGET; k++) {
      const created = new Date(now.getTime() - (90 - k * 30) * 60_000);
      await tx.execute(sql`
        insert into claim (recall_number, firm_id, photo_id, payee_type, payee_value_enc, payee_hash, payee_masked, units_claimed, checks, decision, status, amount, channel,
                           is_sample, decided_at, created_at, updated_at, result)
        values (${recall}, ${firmId}, ${photo}::uuid, 'email', ${encrypt(payee)}, ${hashContact(payee)}, ${maskContact(payee)}, 1, ${JSON.stringify(sampleChecks("paid", k, recall))}::jsonb,
                'verified', 'verified', ${READY_AMOUNT}, ${k % 2 ? "link" : "web"}, true, ${new Date(created.getTime() + 22_000)}, ${created}, ${created},
                ${JSON.stringify(sampleResult("paid", k, recall))}::jsonb)`);
    }
    return READY_TARGET - n;
  });
  if (added) await audit("system", "firm.sample_claims_ready", `firm:${firmId}`, { recall, added, amount: READY_AMOUNT, sample: true });
  return added;
}
