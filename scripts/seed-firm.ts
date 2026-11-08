// Seeds a sample claim history for Brightline Home (fictional) so the firm console is not empty. Safe to run again:
// it replaces the earlier sample history and keeps every claim that has a real PayPal payment.
//
//   npx tsx --env-file=.env.local scripts/seed-firm.ts            the sample history (no model calls, no PayPal calls)
//   npx tsx --env-file=.env.local scripts/seed-firm.ts --record   also runs one live verification (Claude, about $0.20)
//                                                                  and saves it to src/lib/firm/samples/look-alike.json
//
// What it writes, all labelled sample (claim.is_sample = true):
// - about 40 claims on the firm's own sample recall (BH-2026-01, the fictional Brightline 65W charger) from the
//   announcement to today: verified and paid, waiting to be accepted, in firm review, new photo asked. Their payments
//   are "sample history (not paid)": paypal_status SAMPLE, no PayPal batch id, so nothing polls PayPal for them. They
//   use the firm's refund for the recall: the sample shop's price ($34.99) on BH-2026-01, and a labelled $20.00
//   sample amount on the real CPSC recalls the console also lists.
// - two verified claims ready to pay, at the recall's $34.99 refund, to the sandbox buyer (SANDBOX_BUYER_EMAIL, or the sandbox login in
//   TESTING.md): paying them sends real sandbox payouts. The console keeps two ready: when a visitor pays them, the
//   queue adds two more (src/lib/firm/sample-claims.ts). tests/e2e/firm.mjs pays them with bulk "Approve and pay".
// - one firm-review claim on recall 26754 whose photo, checks and Two reviewers come from a recorded live run, when
//   src/lib/firm/samples/look-alike.json exists.
// - the corrective-action plan (announcement, notice waves, reports) with sample payout batches, follow-ups and
//   re-notices, and the first wave of notices.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { sql } from "drizzle-orm";
import { samplePhotoSha } from "../src/app/api/claims/_lib/sample-photo";
import { audit } from "../src/lib/audit";
import { db, dbConfigured } from "../src/lib/db";
import { encrypt, hashContact, maskContact } from "../src/lib/secure";
import { basePlan } from "../src/lib/firm/plan";
import { SAMPLE_RECALL } from "../src/lib/firm/firm";
import { SAMPLE_PAYPAL_STATUS } from "../src/lib/firm/queue";
import { SHOP } from "../src/lib/payments/shop-catalog";
import { ensureReadyClaims, READY_AMOUNT, sampleChecks, samplePhotoFor, samplePhotoIds, sampleResult, type SampleKind } from "../src/lib/firm/sample-claims";
import type { Checks } from "../src/lib/verify/types";

const DAY = 86_400_000;
/**
 * The sample firm's refund per recall (firm_recall.default_refund). The main recall pays the sample shop's price for
 * its fictional charger; the others say "a full refund" of the price paid, which Remedy cannot know, so they use a
 * stated sample amount, labelled in refund_by_model._note.
 */
const SHOP_PRICE = (SHOP.product.priceCents / 100).toFixed(2);
const SAMPLE_AMOUNT = "20.00";
const SAMPLES = path.join(process.cwd(), "src", "lib", "firm", "samples");
const RECORDED = path.join(SAMPLES, "look-alike.json");
const LOOK_ALIKE = { recall: "26754", photo: "official/26125-hair-dryer-cord-cut.png", credit: "Photo: US Consumer Product Safety Commission, recall 26125 (public domain)" };

/** A small seeded random generator, so every run writes the same history. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["jordan", "maria", "sam", "lee", "priya", "alex", "dana", "chris", "noor", "taylor", "kim", "jamie", "rosa", "omar", "beth", "luis", "mei", "ravi", "ana", "tom", "ivy", "hugo", "zoe", "ben", "lena", "max", "nia", "eli", "sara", "joe", "ada", "kai", "liz", "raj", "amy", "dev", "fay", "gus", "ines", "ola"];

type Kind = SampleKind;
/**
 * The history, as fractions of the days since the announcement (0 is the announcement day, 1 is today): paid claims
 * spread over the whole time, three payouts not yet accepted, and the open reviews and retakes in the last days.
 */
const PLAN: { kind: Kind; at: number[] }[] = [
  { kind: "paid", at: Array.from({ length: 23 }, (_, i) => (i / 23) * 0.95) },
  { kind: "unclaimed", at: [0.15, 0.45, 0.6] },
  { kind: "reviewed_paid", at: [0.3, 0.6] },
  { kind: "review_retake", at: [0.5] },
  { kind: "retake", at: [0.7, 0.8, 0.9, 0.97] },
  { kind: "review", at: [0.82, 0.88, 0.93, 0.96, 0.99] },
];
/** Fictional US numbers in the 555-0100 to 555-0199 range. */
const phone = (area: number, k: number) => `(${area}) 555-01${String(k % 100).padStart(2, "0")}`;

const checksFor = (kind: Kind, r: () => number) => sampleChecks(kind, r);

async function sampleFirm() {
  const [f] = (await db().execute(sql`select id, name from firm where is_sample = true order by id limit 1`)).rows as { id: number; name: string }[];
  return f ?? null;
}

/** Remove the earlier sample history. Claims with a real PayPal payment stay, and so do their plan tasks. */
async function clearSamples(firmId: number) {
  const gone = (
    await db().execute(sql`
    select c.id from claim c where c.firm_id = ${firmId} and c.is_sample
      and not exists (select 1 from payment p where p.claim_id = c.id and coalesce(p.paypal_status, '') <> ${SAMPLE_PAYPAL_STATUS})`)
  ).rows as { id: string }[];
  const ids = gone.map((g) => g.id);
  if (ids.length) {
    const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    await db().execute(sql`delete from notice where claim_id in (${list})`);
    // Re-notices a seeded event added for these claims go with them.
    await db().execute(sql`delete from plan_task where firm_id = ${firmId} and kind = 're_notice' and data->>'claimId' in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    const photos = (await db().execute(sql`select photo_id from claim where id in (${list}) and photo_id is not null`)).rows as { photo_id: string }[];
    await db().execute(sql`delete from claim where id in (${list})`);
    for (const p of photos) await db().execute(sql`delete from photo where id = ${p.photo_id}::uuid and source = 'preset' and not exists (select 1 from claim where photo_id = ${p.photo_id}::uuid)`);
  }
  await db().execute(sql`delete from notice where firm_id = ${firmId} and provider = 'sample'`);
  await db().execute(sql`delete from plan_task where firm_id = ${firmId} and (ref like 'sample-%' or ref like 'plan:%')`);
  return ids.length;
}

async function insertClaim(o: {
  firmId: number;
  recall: string;
  payee: { type: "email" | "phone" | "venmo"; value: string };
  checks: Checks;
  decision: "verified" | "retake" | "firm_review";
  status: string;
  amount: string;
  channel: string;
  created: Date;
  decided: Date;
  review?: { outcome: "approved" | "retake"; by: string; at: Date } | null;
  debate?: unknown;
  photoId?: string | null;
  units?: number;
  result?: unknown;
}) {
  const [row] = (
    await db().execute(sql`
    insert into claim (recall_number, firm_id, photo_id, payee_type, payee_value_enc, payee_hash, payee_masked, units_claimed, checks, decision, status, debate, amount, channel,
                       review_outcome, reviewed_by, reviewed_at, is_sample, decided_at, created_at, updated_at, result)
    values (${o.recall}, ${o.firmId}, ${o.photoId ?? null}, ${o.payee.type}, ${encrypt(o.payee.value)}, ${hashContact(o.payee.value)}, ${maskContact(o.payee.value)}, ${o.units ?? 1},
            ${JSON.stringify(o.checks)}::jsonb, ${o.decision}, ${o.status}, ${o.debate ? JSON.stringify(o.debate) : null}::jsonb, ${o.amount}, ${o.channel},
            ${o.review?.outcome ?? null}, ${o.review?.by ?? null}, ${o.review?.at ?? null}, true, ${o.decided}, ${o.created}, ${o.created},
            ${JSON.stringify(o.result ?? sampleResult(o.decision))}::jsonb)
    returning id`)
  ).rows as { id: string }[];
  return row.id;
}

async function samplePayment(o: { amount: string; claimId: string; payee: { type: "email" | "phone" | "venmo"; value: string }; status: "success" | "unclaimed"; at: Date; batch: string; recall: string; title: string; reviewer?: string | null }) {
  const masked = maskContact(o.payee.value);
  const detail = { status: o.status === "success" ? "paid" : "submitted", attempt: 1, recallNumber: o.recall, recallTitle: o.title, payee: { type: o.payee.type, masked }, reasons: { plain: "Sample history (not paid). No money moved.", technical: "Seeded by scripts/seed-firm.ts; no PayPal call." }, approvalRule: o.reviewer ? null : `verified and $${o.amount} is at or under $50.00` };
  const [plan] = (
    await db().execute(sql`
    insert into payment_plan (claim_id, route, amount, approval, approved_by, approved_at, status, detail, created_at, updated_at)
    values (${o.claimId}::uuid, 'payout', ${o.amount}, ${o.reviewer ? "reviewer" : "auto"}, ${o.reviewer ?? "auto rule"}, ${o.at}, ${o.status === "success" ? "done" : "executing"}, ${JSON.stringify(detail)}::jsonb, ${o.at}, ${o.at})
    returning id`)
  ).rows as { id: number }[];
  const paidAt = o.status === "success" ? new Date(o.at.getTime() + 20_000) : null;
  await db().execute(sql`
    insert into payment (plan_id, claim_id, route, amount, status, paypal_status, sender_batch_id, sender_item_id, recipient_type, recipient_wallet, request_id, paid_at, created_at, updated_at)
    values (${plan.id}, ${o.claimId}::uuid, 'payout', ${o.amount}, ${o.status}, ${SAMPLE_PAYPAL_STATUS}, ${o.batch}, ${`claim-${o.claimId}`.slice(0, 64)}, ${o.payee.type === "email" ? "EMAIL" : "PHONE"},
            ${o.payee.type === "venmo" ? "VENMO" : "PAYPAL"}, ${`payout-${o.claimId}-a1`}, ${paidAt}, ${o.at}, ${paidAt ?? o.at})`);
}

async function addTask(t: { firmId: number; recall: string; name: string; kind: string; start: Date; days: number; percent: number; ref: string; dependsOn?: number | null; depType?: number; data?: Record<string, unknown>; order?: number }) {
  const [row] = (
    await db().execute(sql`
    insert into plan_task (firm_id, recall_number, name, kind, start_date, end_date, duration, duration_unit, percent_done, order_index, dependencies, source, ref, data)
    values (${t.firmId}, ${t.recall}, ${t.name}, ${t.kind}, ${t.start}, ${new Date(t.start.getTime() + t.days * DAY)}, ${t.days}, 'day', ${t.percent}, ${t.order ?? 0},
            ${JSON.stringify(t.dependsOn ? [{ from: t.dependsOn, type: t.depType ?? 2 }] : [])}::jsonb, 'seed', ${t.ref}, ${JSON.stringify({ sample: true, ...(t.data ?? {}) })}::jsonb)
    returning id`)
  ).rows as { id: number }[];
  return row.id;
}

/** One live verification of the CPSC's made-safe hair dryer photo (recall 26125) against recall 26754: a look-alike. */
async function record() {
  const { loadFixtureRecalls, fixtureFile } = await import("../src/lib/verify/fixtures");
  const { verifyPhoto } = await import("../src/lib/verify");
  const fx = loadFixtureRecalls()[LOOK_ALIKE.recall];
  if (!fx) throw new Error(`Fixture recall ${LOOK_ALIKE.recall} is missing.`);
  const photo = fixtureFile(LOOK_ALIKE.photo);
  const t0 = Date.now();
  const result = await verifyPhoto({ photo, mime: "image/png", recall: fx.recall, proofRule: fx.rule, claimContext: { firmName: "Brightline Home", firmAmount: { value: "1.00", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } } });
  mkdirSync(SAMPLES, { recursive: true });
  writeFileSync(RECORDED, JSON.stringify({ recordedAt: new Date().toISOString(), recall: LOOK_ALIKE.recall, photo: LOOK_ALIKE.photo, credit: LOOK_ALIKE.credit, ms: Date.now() - t0, result }, null, 2));
  console.log(`seed-firm: recorded a live verification: ${result.decision} (decided by ${result.decided_by}), reviewers ${result.review ? "ran" : "did not run"}; usage`, JSON.stringify(result.usage));
}

async function main() {
  if (!dbConfigured()) throw new Error("DATABASE_URL is not set. Run with: npx tsx --env-file=.env.local scripts/seed-firm.ts");
  if (process.argv.includes("--record")) await record();
  const firm = await sampleFirm();
  if (!firm) throw new Error("The sample firm is not seeded yet. Run scripts/seed.ts first.");
  const [recall] = (await db().execute(sql`select number, title, to_char(date, 'YYYY-MM-DD') as date from recall where number = ${SAMPLE_RECALL}`)).rows as { number: string; title: string; date: string }[];
  if (!recall) throw new Error(`Recall ${SAMPLE_RECALL} is not loaded yet. Run scripts/load-recalls.ts first.`);
  // Each recall's announcement date, and the firm's refund: the shop price for the main recall, a labelled sample
  // amount for the others. An amount the firm already set is kept.
  await db().execute(sql`
    update firm_recall fr set announced_on = coalesce(fr.announced_on, r.date),
      default_refund = coalesce(fr.default_refund, case when fr.recall_number = ${recall.number} then ${SHOP_PRICE}::numeric else ${SAMPLE_AMOUNT}::numeric end),
      refund_by_model = fr.refund_by_model || jsonb_build_object('_note', case when fr.recall_number = ${recall.number}
        then ${`Sample firm setting: $${SHOP_PRICE}, the sample shop's price for its fictional charger.`}::text
        else ${`Sample amount: $${SAMPLE_AMOUNT}. The recall offers a full refund of the price paid, which Remedy cannot know.`}::text end)
    from recall r where r.number = fr.recall_number and fr.firm_id = ${firm.id}`);

  const removed = await clearSamples(firm.id);
  // Brightline's published sample photo never stays in the earlier-claims pool (src/app/api/claims/_lib/sample-photo.ts),
  // so every visitor can claim the sample recall with it, including after a claim made before this rule.
  const sampleSha = samplePhotoSha();
  if (sampleSha) await db().execute(sql`delete from image_hash ih using photo p where ih.source = 'claim' and ih.ref = p.id::text and p.sha256 = ${sampleSha}`);
  const r = rng(26_0101);
  const now = new Date();
  const announced = new Date(`${recall.date}T15:00:00Z`);
  const span = Math.max(DAY, now.getTime() - announced.getTime());
  const latest = now.getTime() - 60 * 60_000;
  const when = (fraction: number) => new Date(Math.min(latest, announced.getTime() + fraction * span + (r() - 0.5) * 4 * 3_600_000));

  const kinds = PLAN.flatMap((p) => p.at.map((f) => ({ kind: p.kind, f })));
  // Real thumbnails in the queue and the drawer: the sample set's own photos of the charger (public/samples/charger).
  const photoIds = recall.number === SAMPLE_RECALL ? await samplePhotoIds() : {};
  const channels = ["link", "link", "link", "web", "link", "email", "link", "web", "api", "link"];
  const batches = new Map<string, { claims: string[]; day: Date }>();
  const unclaimed: { claimId: string; batchKey: string }[] = [];
  let n = 0;
  for (const { kind, f } of kinds) {
    const i = n++;
    const created = when(f);
    const name = NAMES[i % NAMES.length];
    const payee: { type: "email" | "phone" | "venmo"; value: string } = i % 9 === 4 ? { type: "phone", value: phone(415, i) } : i % 13 === 7 ? { type: "venmo", value: phone(212, i) } : { type: "email", value: `${name}.${100 + i}@example.com` };
    const decision = kind === "paid" || kind === "unclaimed" ? "verified" : kind === "retake" ? "retake" : "firm_review";
    const reviewer = i % 2 ? "Ana" : "Devon";
    const reviewedAt = new Date(Math.min(latest, created.getTime() + (6 + r() * 30) * 3_600_000));
    const review = kind === "reviewed_paid" ? { outcome: "approved" as const, by: reviewer, at: reviewedAt } : kind === "review_retake" ? { outcome: "retake" as const, by: reviewer, at: reviewedAt } : null;
    const status = kind === "paid" || kind === "reviewed_paid" ? "approved" : kind === "unclaimed" ? "approved" : kind === "review" ? "firm_review" : "retake";
    const id = await insertClaim({
      firmId: firm.id,
      recall: recall.number,
      payee,
      checks: checksFor(kind, r),
      decision,
      status,
      amount: SHOP_PRICE,
      channel: channels[i % channels.length],
      created,
      decided: new Date(created.getTime() + 25_000),
      review,
      units: i % 11 === 3 ? 2 : 1,
      photoId: photoIds[samplePhotoFor(kind, i)] ?? null,
    });
    if (kind === "paid" || kind === "unclaimed" || kind === "reviewed_paid") {
      // Paid in the next morning's batch (17:00 UTC, 9 am Pacific), once the claim is verified or approved.
      const ready = review ? review.at : created;
      const batchDay = new Date(Date.UTC(ready.getUTCFullYear(), ready.getUTCMonth(), ready.getUTCDate() + 1, 17, 0, 0));
      const batchAt = batchDay.getTime() > now.getTime() - 30 * 60_000 ? new Date(now.getTime() - 40 * 60_000) : batchDay;
      const key = batchAt.toISOString().slice(0, 10);
      const b = batches.get(key) ?? { claims: [], day: batchAt };
      b.claims.push(id);
      batches.set(key, b);
      await samplePayment({ amount: SHOP_PRICE, claimId: id, payee, status: kind === "unclaimed" ? "unclaimed" : "success", at: batchAt, batch: `sample-${recall.number}-${key}`, recall: recall.number, title: recall.title, reviewer: review ? review.by : null });
      if (kind === "unclaimed") unclaimed.push({ claimId: id, batchKey: key });
    }
  }

  // Claims ready to pay, at the recall's $34.99 refund, to the sandbox buyer: bulk "Approve and pay" sends real sandbox payouts. The
  // console tops them up the same way whenever the queue is read with fewer left (src/lib/firm/sample-claims.ts).
  const ready = await ensureReadyClaims(firm.id, recall.number, now);
  if (!ready) console.log("seed-firm: the claims ready to pay were already there (or no sandbox buyer is known).");

  // The recorded look-alike on recall 26754, if it was recorded.
  let recorded = false;
  if (existsSync(RECORDED)) {
    const rec = JSON.parse(readFileSync(RECORDED, "utf8")) as {
      result: { decision: "verified" | "retake" | "firm_review"; decided_by: string; checks: Checks; review: unknown; summary: unknown; guidance?: unknown; quality: { ok: boolean; issues: string[] }; timings: unknown; model: string | null; usage: unknown };
    };
    const bytes = readFileSync(path.join(process.cwd(), "content", "verify", "fixtures", LOOK_ALIKE.photo));
    const sha = createHash("sha256").update(bytes).digest("hex");
    const [ph] = (await db().execute(sql`insert into photo (sha256, mime, size, bytes, source) values (${sha}, 'image/png', ${bytes.length}, ${bytes}, 'preset') returning id`)).rows as { id: string }[];
    const created = new Date(now.getTime() - 5 * 3_600_000);
    await insertClaim({
      firmId: firm.id,
      recall: LOOK_ALIKE.recall,
      payee: { type: "email", value: "lena.250@example.com" },
      checks: rec.result.checks,
      decision: rec.result.decision,
      status: rec.result.decision === "firm_review" ? "firm_review" : rec.result.decision,
      amount: SAMPLE_AMOUNT,
      channel: "web",
      created,
      decided: new Date(created.getTime() + 40_000),
      debate: rec.result.review,
      photoId: ph.id,
      result: { decided_by: rec.result.decided_by, guidance: rec.result.guidance ?? null, summary: rec.result.summary, quality: { ok: rec.result.quality.ok, issues: rec.result.quality.issues }, timings: rec.result.timings, model: rec.result.model, usage: rec.result.usage, recorded: true },
    });
    recorded = true;
  }

  // The plan: the base plan with its progress, then the sample payout batches, follow-ups and re-notices.
  const base = basePlan(recall.number, recall.date);
  const ids = new Map<string, number>();
  const today = now.toISOString().slice(0, 10);
  for (const [k, t] of base.entries()) {
    const start = new Date(`${t.start}T00:00:00Z`);
    const end = start.getTime() + t.duration * DAY;
    const percent = t.kind === "announcement" ? 100 : end <= now.getTime() ? 100 : start.getTime() <= now.getTime() ? 50 : 0;
    ids.set(t.ref, await addTask({ firmId: firm.id, recall: recall.number, name: t.name, kind: t.kind, start, days: t.duration, percent, ref: t.ref, dependsOn: t.dependsOn ? ids.get(t.dependsOn) : null, order: k }));
  }
  const batchIds = new Map<string, number>();
  for (const [key, b] of [...batches.entries()].sort()) {
    const start = new Date(`${key}T00:00:00Z`);
    const id = await addTask({ firmId: firm.id, recall: recall.number, name: `Payout batch: ${b.claims.length} ${b.claims.length === 1 ? "refund" : "refunds"} (sample)`, kind: "payout_batch", start, days: 1, percent: 100, ref: `sample-batch:${recall.number}:${key}`, data: { claims: b.claims, totalCents: b.claims.length * SHOP.product.priceCents } });
    batchIds.set(key, id);
    await addTask({ firmId: firm.id, recall: recall.number, name: "Follow-up: payouts not accepted after 30 days", kind: "follow_up", start: new Date(start.getTime() + 30 * DAY), days: 1, percent: 0, ref: `sample-follow-up:${recall.number}:${key}`, dependsOn: id });
  }
  for (const u of unclaimed) {
    const start = new Date(`${u.batchKey}T00:00:00Z`).getTime() + DAY;
    await addTask({ firmId: firm.id, recall: recall.number, name: "Re-notice: payout waiting (sample)", kind: "re_notice", start: new Date(Math.min(start, Date.parse(`${today}T00:00:00Z`))), days: 2, percent: start + 2 * DAY < now.getTime() ? 100 : 0, ref: `sample-re-notice:${u.claimId}`, dependsOn: batchIds.get(u.batchKey), data: { claimId: u.claimId, status: "unclaimed" } });
  }

  // Notice wave 1: the buyers in the firm's sales records, by email and text, over the first two days.
  const waveStart = announced.getTime() + 2 * 3_600_000;
  for (let k = 0; k < 60; k++) {
    const contact = k % 8 === 3 ? phone(312, k) : `${NAMES[k % NAMES.length]}.${100 + k}@example.com`;
    const sentAt = new Date(Math.min(now.getTime() - DAY / 2, waveStart + (k / 60) * 1.5 * DAY));
    await db().execute(sql`
      insert into notice (firm_id, recall_number, kind, channel, recipient_hash, status, provider, sent_at, created_at)
      values (${firm.id}, ${recall.number}, 'notice', ${contact.includes("@") ? "email" : "sms"}, ${hashContact(contact)}, 'sent', 'sample', ${sentAt}, ${sentAt})`);
  }

  await audit("system", "seed.firm_history", `firm:${firm.id}`, { recall: recall.number, claims: kinds.length, ready, recorded, removed });
  console.log(`seed-firm: ${kinds.length} sample claims on ${recall.number}, ${ready} new claims ready to pay ($${READY_AMOUNT} each), ${batches.size} sample payout batches, ${unclaimed.length} waiting to be accepted${recorded ? ", 1 recorded look-alike on 26754" : ""}; removed ${removed} earlier sample claims.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-firm failed:", (e as Error).message);
  process.exit(1);
});
