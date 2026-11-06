import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, dbConfigured, schema } from "@/lib/db";
import { MODEL } from "@/lib/ai/claude";
import { log } from "@/lib/log";
import { LABEL_MAX_SIDE, OFFICIAL_MAX_SIDE, VISION_MAX_SIDE } from "./image";
import { VISION_OFFICIAL_IMAGES } from "./official";
import { REVIEWER_SYSTEM, type Review } from "./reviewers";
import { effortFor, VISION_SYSTEM, type Effort, type VisionRun } from "./vision";
import { ReviewSchema, VisionReportSchema } from "./vision-schema";
import type { Decision, VerifyProofRule } from "./types";
import { z } from "zod";

/**
 * The verification cache: the same photo for the same recall, rule and engine is answered without a model call, in
 * production too. Only the model's outputs are stored (the vision report and the two reviews), never the decision
 * itself: every check that depends on the claim (C3 against earlier claims, C5 limits, C6 refunds, the amount) runs
 * again in code each time. So a second owner sending the same photo still meets the earlier-claim check.
 *
 * Key: sha256 of photo bytes + recall number + proof-rule version + engine version. The engine version is a hash of
 * everything that shapes the model's answer (prompts, schemas, image sizes) plus the model and effort, so any change
 * starts fresh entries instead of serving stale ones.
 */

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** Prompts, schemas and image sizes: a change to any of them is a new engine version. */
export const ENGINE_HASH = sha(
  JSON.stringify([
    VISION_SYSTEM,
    REVIEWER_SYSTEM,
    z.toJSONSchema(VisionReportSchema),
    z.toJSONSchema(ReviewSchema),
    VISION_MAX_SIDE,
    LABEL_MAX_SIDE,
    OFFICIAL_MAX_SIDE,
    VISION_OFFICIAL_IMAGES,
  ]),
).slice(0, 12);

export function engineVersion(model = MODEL, effort?: Effort): string {
  return `${ENGINE_HASH}:${model}:${effortFor(model, effort) ?? "default"}`;
}

/** The parts of a proof rule the model reads, in a fixed order. A firm editing its rule makes a new version. */
export function ruleVersion(rule: VerifyProofRule): string {
  return sha(
    JSON.stringify({
      actions: [...rule.actions],
      marker_text: rule.marker_text ?? null,
      must_show: [...rule.must_show],
      steps: rule.steps ? [...rule.steps] : null,
      plain: rule.explanation?.plain ?? null,
    }),
  ).slice(0, 12);
}

export const photoSha256 = (bytes: Buffer | Uint8Array) => sha(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));

export function cacheKey(k: { photoSha256: string; recallNumber: string; ruleVersion: string; engineVersion: string }): string {
  return sha(`${k.photoSha256}|${k.recallNumber}|${k.ruleVersion}|${k.engineVersion}`);
}

/** What is stored: the model's outputs only. */
export type CachedOutputs = { vision: VisionRun | null; reviews: Review[] | null };

export type CacheEntry = {
  key: string;
  recallNumber: string;
  photoSha256: string;
  ruleVersion: string;
  engineVersion: string;
  /** The decision when it was stored, for the firm's view; never served as the answer. */
  decision: Decision;
  result: CachedOutputs;
  source: "live" | "precomputed";
};

export interface VerifyCache {
  get(key: string): Promise<CacheEntry | null>;
  put(entry: CacheEntry): Promise<void>;
}

/** In-process cache, for tests and for running without a database. */
export function memoryVerifyCache(): VerifyCache & { entries: Map<string, CacheEntry> } {
  const entries = new Map<string, CacheEntry>();
  return {
    entries,
    async get(key) {
      return entries.get(key) ?? null;
    },
    async put(entry) {
      const prev = entries.get(entry.key);
      entries.set(entry.key, prev?.source === "precomputed" && entry.source === "live" ? { ...entry, source: "precomputed" } : entry);
    },
  };
}

/** The verify_result table. A cache problem never fails a claim: get returns null and put logs. */
export const dbVerifyCache: VerifyCache = {
  async get(key) {
    try {
      const [row] = await db().select().from(schema.verifyResults).where(eq(schema.verifyResults.key, key)).limit(1);
      if (!row) return null;
      void db()
        .update(schema.verifyResults)
        .set({ hits: sql`${schema.verifyResults.hits} + 1`, lastHitAt: new Date() })
        .where(eq(schema.verifyResults.key, key))
        .catch(() => {});
      return {
        key: row.key,
        recallNumber: row.recallNumber,
        photoSha256: row.photoSha256,
        ruleVersion: row.ruleVersion,
        engineVersion: row.engineVersion,
        decision: row.decision as Decision,
        result: row.result as CachedOutputs,
        source: row.source as CacheEntry["source"],
      };
    } catch (e) {
      log.error("verify_result: read failed", { error: e });
      return null;
    }
  },
  async put(e) {
    try {
      await db()
        .insert(schema.verifyResults)
        .values({ key: e.key, recallNumber: e.recallNumber, photoSha256: e.photoSha256, ruleVersion: e.ruleVersion, engineVersion: e.engineVersion, decision: e.decision, result: e.result, source: e.source })
        .onConflictDoUpdate({
          target: schema.verifyResults.key,
          // A precomputed preset stays marked precomputed when a live run later adds the reviews to it.
          set: { decision: e.decision, result: e.result, source: sql`case when ${schema.verifyResults.source} = 'precomputed' then 'precomputed' else excluded.source end` },
        });
    } catch (err) {
      log.error("verify_result: write failed", { error: err });
    }
  },
};

/** The default store: the database when there is one, otherwise none. */
export const defaultVerifyCache = (): VerifyCache | null => (dbConfigured() ? dbVerifyCache : null);
