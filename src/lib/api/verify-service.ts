/**
 * Photo verification for the public API (POST /api/v1/verify) and the MCP tool verify_photo. No claim is stored and
 * nothing is paid: this answers "would this photo be accepted for this recall?".
 *
 * Spend care: without an API key only the free checks run (the photo's quality, and whether it matches the recall's
 * official CPSC pictures or an earlier claim), with no AI call. With a key the full checks run, at most
 * VERIFY_LIMITS.visionPerKeyPerDay a day, and never when the site's daily AI budget is used up.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { overBudget } from "@/lib/ai/usage";
import { db, dbConfigured, schema } from "@/lib/db";
import { verifyPhoto, type HashRef, type VerifyResult } from "@/lib/verify";
import { hashKey } from "./keys";
import { recallByNumber, storedRule, summarize } from "./recall-data";
import { VERIFY_LIMITS } from "./v1-schemas";

export type VerifyMode = "full" | "free";

/** The API key row behind a request's bearer token, or null. guard() has already turned away revoked keys. */
export async function keyIdFor(req: Request): Promise<number | null> {
  const h = req.headers.get("authorization");
  const token = h?.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : req.headers.get("x-api-key")?.trim();
  if (!token || !dbConfigured()) return null;
  const [row] = await db().select({ id: schema.apiKeys.id }).from(schema.apiKeys).where(eq(schema.apiKeys.hash, hashKey(token))).limit(1);
  return row?.id ?? null;
}

/** Successful calls a key made to an endpoint in the last 24 hours. */
export async function callsToday(keyId: number, endpoint: string): Promise<number> {
  if (!dbConfigured()) return 0;
  const [r] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.apiUsage)
    .where(and(eq(schema.apiUsage.keyId, keyId), eq(schema.apiUsage.endpoint, endpoint), eq(schema.apiUsage.status, 200), gte(schema.apiUsage.at, new Date(Date.now() - 86_400_000))));
  return r?.n ?? 0;
}

/** Decide how much of the check runs, and say why in plain words. */
export async function verifyMode(keyId: number | null, endpoint: string): Promise<{ mode: VerifyMode; note: string }> {
  if (!keyId) return { mode: "free", note: "Without an API key only the free checks run: photo quality and the own-photo match. Add a key for the full checks." };
  if (!process.env.ANTHROPIC_API_KEY) return { mode: "free", note: "The AI service is not connected on this server, so only the free checks ran." };
  if ((await callsToday(keyId, endpoint)) >= VERIFY_LIMITS.visionPerKeyPerDay) return { mode: "free", note: `This key has run ${VERIFY_LIMITS.visionPerKeyPerDay} full checks today, so only the free checks ran. The limit resets over the next 24 hours.` };
  const budget = await overBudget().catch(() => ({ over: false }));
  if (budget.over) return { mode: "free", note: "The photo checker has used today's AI budget, so only the free checks ran." };
  return { mode: "full", note: "All checks ran, including the vision checks by Claude Opus 5.5." };
}

async function priorClaimHashes(recall: string): Promise<HashRef[]> {
  if (!dbConfigured()) return [];
  try {
    const rows = await db()
      .select({ ref: schema.imageHashes.ref, dhash: schema.imageHashes.dhash })
      .from(schema.imageHashes)
      .where(and(eq(schema.imageHashes.source, "claim"), eq(schema.imageHashes.recallNumber, recall)))
      .limit(5000);
    return rows;
  } catch {
    return [];
  }
}

export class VerifyInputError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code: "invalid_request" | "not_found" = "invalid_request",
  ) {
    super(message);
  }
}

/** Run the checks for one photo against one recall's stored proof rule. */
export async function verifyForApi(o: { photo: Uint8Array; mime?: string; recallNumber: string; amount?: string | null; mode: VerifyMode }) {
  const recall = recallByNumber(o.recallNumber);
  if (!recall) throw new VerifyInputError(`There is no recall ${o.recallNumber} in Remedy's data. Search for it with GET /api/v1/recalls.`, 404, "not_found");
  const stored = storedRule(recall.number);
  if (!stored) throw new VerifyInputError(`Recall ${recall.number} has no proof rule yet. Read one from its remedy text with POST /api/v1/proof-rule.`, 422);
  if (o.photo.byteLength === 0) throw new VerifyInputError("The photo is empty. Send a JPEG, PNG or WebP file in the photo field.");
  if (o.photo.byteLength > VERIFY_LIMITS.maxBytes) throw new VerifyInputError("The photo is larger than 10 MB. Send a smaller copy.", 413);
  const amount = o.amount && /^\d{1,4}(\.\d{1,2})?$/.test(o.amount) ? Number(o.amount).toFixed(2) : null;
  const free = o.mode === "free";

  const result: VerifyResult = await verifyPhoto(
    {
      photo: Buffer.from(o.photo),
      mime: o.mime,
      recall: {
        number: recall.number,
        title: recall.title,
        description: recall.description,
        remedyText: recall.remedyText,
        products: recall.products.map((p) => ({ name: p.name, model: p.model, description: p.description, type: p.type, units: p.units })),
        // The free checks compare with the stored hashes of these images, so nothing needs downloading.
        images: free ? [] : recall.images.map((i) => ({ url: i.url, caption: i.caption })),
        units: recall.units,
      },
      proofRule: stored.rule,
      priorHashes: await priorClaimHashes(recall.number),
      claimContext: amount ? { firmAmount: { value: amount, currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } } : {},
      options: { reviewers: !free },
    },
    free ? { aiAvailable: () => false } : {},
  );
  return { recall, rule: stored.rule, result, amount };
}

/** The verify response body: every check with its plain and technical reason, the decision, and the timings. */
export function verifyBody(v: Awaited<ReturnType<typeof verifyForApi>>, mode: VerifyMode, note: string, sha256: string) {
  const r = v.result;
  return {
    decision: r.decision,
    decided_by: r.decided_by,
    mode,
    mode_note: note,
    summary: r.summary,
    guidance: r.guidance ?? null,
    checks: Object.fromEntries(
      Object.values(r.checks).map((c) => [c.id, { name: c.name, status: c.status, pass: c.pass, score: c.score ?? null, reason: c.reason_plain, technical: c.reason_technical }]),
    ),
    amount: r.amount,
    recall: { number: v.recall.number, title: v.recall.title },
    proof_rule: summarize(v.rule),
    photo: { sha256, dhash: r.photo.dhash, width: r.photo.width, height: r.photo.height, mime: r.photo.mime },
    review: r.review,
    model: r.model,
    timings: r.timings,
    payment: null,
    note: "No claim was stored and nothing was paid. To open a claim and pay the refund, use POST /api/claims.",
  };
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
