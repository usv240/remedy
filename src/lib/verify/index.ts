import { aiAvailable } from "@/lib/ai/claude";
import { overBudget, RESTING_PLAIN } from "@/lib/ai/usage";
import { cacheKey, defaultVerifyCache, engineVersion, photoSha256, ruleVersion, type VerifyCache } from "./cache";
import {
  computeAmount,
  evaluateC1,
  evaluateC2,
  evaluateC3,
  evaluateC4,
  evaluateC5,
  evaluateC6,
  hashMatches,
  skipped,
  unavailable,
  type ActionFinding,
  type OwnPhotoKind,
} from "./checks";
import { decide, guidanceFor, shouldReview, summaryFor, type Blocker, type DecidedBy } from "./decide";
import { CATALOG_MAX_DISTANCE, closestMatch, dhashVariants, otherRecallMatch, storedOfficialHashes } from "./dhash";
import { claimMaxSide, decodeImage, PhotoUnreadableError, sniffMime, type DecodedImage } from "./image";
import { fetchImageBytes, loadOfficialImages, MAX_OFFICIAL_IMAGES, pickForVision, type FetchImage, type OfficialImage } from "./official";
import { assessQuality } from "./quality";
import { debatePayload, referee, runReviewers, type ReviewArgs, type ReviewRun } from "./reviewers";
import { runVision, type Effort, type VisionArgs, type VisionRun } from "./vision";
import { personInPhoto } from "./vision-schema";
import type { Amount, Checks, ClaimContext, Decision, Guidance, HashRef, QualityReport, Timings, VerifyProofRule, VerifyRecall } from "./types";

export * from "./types";
export { VISION_UNAVAILABLE, LIMITS, CHECK_NAMES, computeAmount, toCents, fromCents, markerMatches } from "./checks";
export { dhash, dhashGrey, dhashVariants, photoHashes, hamming, closestMatch, storedOfficialHashes, DUPLICATE_MAX_DISTANCE } from "./dhash";
export { QUALITY_LIMITS, assessQuality } from "./quality";
export { decide } from "./decide";
export { referee, runReviewers, debatePayload, REVIEWER } from "./reviewers";
export { loadOfficialImages, pickForVision } from "./official";
export { submitVisionBatch, visionBatchStatus, collectVisionBatch, visionBatchRequest } from "./batch";
export { extractModels, extractRanges, matchModel, inRange, normalizeDateCode, parseUnits } from "./identifiers";
export { cacheKey, engineVersion, ruleVersion, photoSha256, memoryVerifyCache, dbVerifyCache, type VerifyCache } from "./cache";

export type VerifyInput = {
  photo: Buffer | Uint8Array;
  mime?: string;
  recall: VerifyRecall;
  proofRule: VerifyProofRule;
  /** Hashes of earlier claim photos for this same recall (image_hash rows with source "claim"). */
  priorHashes?: readonly HashRef[];
  /**
   * Hashes of earlier claim photos on every other recall, from any firm, matched only at CATALOG_MAX_DISTANCE. Only the
   * hash crosses between recalls and firms; a match sends the claim to a person, never to a retake.
   */
  elsewhereHashes?: readonly HashRef[];
  /**
   * Hashes of this recall's own official images. Defaults to the stored ones in content/recalls/image-hashes.json;
   * the images loaded for the vision check are always added. Never pass other recalls' images here: product shots on
   * white look alike, and 447 of 1,821 official images sit within 10 bits of an image from a different recall. Other
   * recalls' pictures are matched separately, at CATALOG_MAX_DISTANCE (otherRecallMatch in ./dhash).
   */
  officialHashes?: readonly HashRef[];
  claimContext?: ClaimContext;
  options?: {
    /** Run the Two reviewers on firm-review cases. Default true. */
    reviewers?: boolean;
    effort?: Effort;
    /** Compare with the recall's official images. Default true; off only to evaluate C1 and C2 on CPSC's own example photos. */
    officialHashCheck?: boolean;
    /** Read and write the verification cache. Default true; sweeps and benchmarks turn it off. */
    cache?: boolean;
    /** How a new cache entry is marked: precomputed for demo presets computed once with approval. */
    cacheSource?: "live" | "precomputed";
  };
};

/** Seams for tests and for hosting the vision step elsewhere (for example an Astropods agent). */
export type VerifyDeps = {
  vision?: (a: VisionArgs) => Promise<VisionRun>;
  reviewers?: (a: ReviewArgs) => Promise<ReviewRun>;
  fetchImage?: FetchImage;
  aiAvailable?: () => boolean;
  /** The verification cache. Defaults to the verify_result table when there is a database and no test seam is set. */
  cache?: VerifyCache | null;
  /** The daily AI budget check. Defaults to AI_DAILY_USD against the ai_usage log. */
  overBudget?: () => Promise<{ over: boolean; usd: number; budget: number }>;
};

export type VerifyResult = {
  decision: Decision;
  decided_by: DecidedBy;
  checks: Checks;
  guidance?: Guidance;
  summary: { plain: string; technical: string };
  amount: Amount | null;
  quality: QualityReport;
  /** `dhash` is the upright hash to store (image_hash, source "claim"); `dhash_variants` are all eight orientations, for matching in SQL. */
  photo: { dhash: string | null; dhash_variants: string[]; width: number; height: number; exif: boolean; mime: string | null; sha256: string };
  /** A person (a face, a body or a child) seen in the photo by the vision call: the claim deletes the stored photo. */
  person: { visible: true; kinds: string[] } | null;
  review: ReturnType<typeof debatePayload> | null;
  blockers: Blocker[];
  model: string | null;
  usage: { vision: VisionRun["usage"] | null; reviewers: VisionRun["usage"][] };
  /** Whether the model's answers came from the verification cache (no cost) and whether this run stored new ones. */
  cache: { key: string; vision: "hit" | "live" | "none"; reviewers: "hit" | "live" | "none"; stored: boolean };
  official: { loaded: number; failed: string[]; sent: number };
  timings: Timings;
};

const ms = (t: number) => Math.round(performance.now() - t);

const urlKey = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
function dedupeRefs(refs: HashRef[]): HashRef[] {
  const seen = new Map<string, HashRef>();
  for (const r of refs) {
    const k = `${urlKey(r.ref)}|${r.dhash}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()];
}

function emptyQuality(): QualityReport {
  return { ok: false, issues: [], metrics: { width: 0, height: 0, sharpness: 0, laplacianVariance: 0, meanLuma: 0, p95Luma: 0, p05Luma: 0 } };
}

/** When the daily budget is spent, checks that needed vision say so kindly instead of the generic line. */
function resting(checks: Checks): Checks {
  const out = { ...checks };
  for (const id of Object.keys(out) as (keyof Checks)[]) if (out[id].status === "unavailable") out[id] = { ...out[id], reason_plain: RESTING_PLAIN };
  return out;
}

/**
 * Verify one claim photo against one recall. Never throws for a bad photo or a missing AI service: those become a
 * retake or a firm review. The order is cheap first:
 *  1. decode, quality precheck and dHash, while the official images load (no model call);
 *  2. a match with this recall's official images asks for the owner's own photo; low quality asks for a retake;
 *  3. the verification cache, then the daily budget, then one structured vision call for C1 to C4, with C5 and C6 alongside;
 *  4. the decision in code; firm-review cases get the Two reviewers and the referee (cached the same way).
 */
export async function verifyPhoto(input: VerifyInput, deps: VerifyDeps = {}): Promise<VerifyResult> {
  const t0 = performance.now();
  const ctx = input.claimContext ?? {};
  const rule = input.proofRule;
  const recall = input.recall;
  const timings: Timings = { decode_ms: 0, official_ms: 0, vision_ms: 0, checks_ms: 0, reviewers_ms: 0, total_ms: 0 };
  const ai = deps.aiAvailable ?? aiAvailable;
  const budgetCheck = deps.overBudget ?? overBudget;
  const bytes = input.photo instanceof Buffer ? input.photo : Buffer.from(input.photo);
  const mime = sniffMime(bytes) ?? input.mime ?? null;

  // The cache: on by default with a database, off when a test seam stands in for the model and no cache is given.
  const cache = input.options?.cache === false ? null : deps.cache !== undefined ? deps.cache : deps.vision || deps.reviewers ? null : defaultVerifyCache();
  const sha256 = photoSha256(bytes);
  const key = cacheKey({ photoSha256: sha256, recallNumber: recall.number, ruleVersion: ruleVersion(rule), engineVersion: engineVersion(undefined, input.options?.effort) });
  const cacheInfo: VerifyResult["cache"] = { key, vision: "none", reviewers: "none", stored: false };

  // Stored hashes cover every official image of the recall, so only the two Claude sees need downloading;
  // without stored hashes, up to five are loaded so the hash check still covers them.
  const storedHashes = input.officialHashes ?? storedOfficialHashes(recall.number);
  const toLoad = storedHashes.length ? pickForVision(recall.images) : recall.images.slice(0, MAX_OFFICIAL_IMAGES);
  const officialStarted = performance.now();
  const officialP = loadOfficialImages(toLoad, deps.fetchImage ?? fetchImageBytes, toLoad.length).then((r) => {
    timings.official_ms = ms(officialStarted);
    return r;
  });
  const cachedP = cache ? cache.get(key) : Promise.resolve(null);
  const c5 = evaluateC5(ctx, recall);
  const c6P = evaluateC6(ctx);
  const amount = computeAmount(ctx);

  let img: DecodedImage;
  const decodeStarted = performance.now();
  try {
    img = await decodeImage(bytes, claimMaxSide(rule.must_show));
  } catch (e) {
    if (!(e instanceof PhotoUnreadableError)) throw e;
    const [c6, off] = await Promise.all([c6P, officialP]);
    const checks: Checks = {
      C1: skipped("C1", "The photo could not be decoded."),
      C2: skipped("C2", "The photo could not be decoded."),
      C3: skipped("C3", "The photo could not be decoded."),
      C4: skipped("C4", "The photo could not be decoded."),
      C5: c5,
      C6: c6,
    };
    const guidance = guidanceFor("unreadable", { quality: emptyQuality(), checks, findings: [], rule, recall })!;
    timings.decode_ms = ms(decodeStarted);
    timings.total_ms = ms(t0);
    return {
      decision: "retake",
      decided_by: "unreadable",
      checks,
      guidance,
      summary: { plain: guidance.plain, technical: `${(e as Error).message} Detected type: ${mime ?? "unknown"}.` },
      amount: amount.amount,
      quality: emptyQuality(),
      photo: { dhash: null, dhash_variants: [], width: 0, height: 0, exif: false, mime, sha256 },
      person: null,
      review: null,
      blockers: [],
      model: null,
      usage: { vision: null, reviewers: [] },
      cache: cacheInfo,
      official: { loaded: off.images.length, failed: off.failed, sent: 0 },
      timings,
    };
  }
  const quality = assessQuality(img.qualityGrey, img);
  const variants = dhashVariants(img.hashGrey);
  timings.decode_ms = ms(decodeStarted);

  const official = await officialP;
  const visionImages = pickForVision(official.images);
  // This recall's own pictures and earlier claims at DUPLICATE_MAX_DISTANCE; every other recall's at CATALOG_MAX_DISTANCE.
  const officialHashes: HashRef[] =
    input.options?.officialHashCheck === false ? [] : dedupeRefs([...storedHashes, ...official.images.map((o) => ({ ref: o.url, dhash: o.dhash, caption: o.caption }))]);
  const hashes = hashMatches(variants, officialHashes, input.priorHashes ?? []);
  const elsewhere = {
    official: input.options?.officialHashCheck === false || hashes.official ? null : otherRecallMatch(variants, recall.number),
    prior: hashes.prior || !input.elsewhereHashes?.length ? null : closestMatch(variants, input.elsewhereHashes, CATALOG_MAX_DISTANCE),
  };
  const cached = await cachedP;
  let restingToday = false;

  const finish = async (o: { checks: Checks; ownPhoto: OwnPhotoKind; findings: ActionFinding[]; vision: VisionRun | null; tip?: string; officialImgs: OfficialImage[] }): Promise<VerifyResult> => {
    const person = personInPhoto(o.vision?.report);
    const first = decide({ quality, checks: o.checks, ownPhoto: o.ownPhoto, amount, personVisible: Boolean(person) });
    let verdict = first;
    let reviewRun: ReviewRun | null = null;
    let reviewError: string | null = null;
    if (first.decision === "firm_review" && (input.options?.reviewers ?? true) && shouldReview(o.checks, first.blockers)) {
      const started = performance.now();
      if (cached?.result.reviews?.length === 2) {
        const reviews = cached.result.reviews;
        reviewRun = { ...referee(reviews, { recall, rule }), reviews, ms: 0, model: reviews[0].model };
        cacheInfo.reviewers = "hit";
      } else if (deps.reviewers || ai()) {
        const budget = deps.reviewers ? { over: false } : await budgetCheck();
        if (budget.over) reviewError = "The daily AI budget is spent.";
        else {
          try {
            reviewRun = await (deps.reviewers ?? runReviewers)({ photo: img.jpeg, recall, rule, official: o.officialImgs, effort: input.options?.effort });
            cacheInfo.reviewers = "live";
          } catch (e) {
            reviewError = (e as Error).message;
          }
        }
      }
      if (reviewRun) verdict = decide({ quality, checks: o.checks, ownPhoto: o.ownPhoto, amount, review: reviewRun, personVisible: Boolean(person) });
      timings.reviewers_ms = ms(started);
    }
    const guidance = guidanceFor(verdict.decided_by, { quality, checks: o.checks, findings: o.findings, rule, recall, tip: o.tip, person });
    const summary = summaryFor(verdict.decision, verdict.decided_by, { guidance, firmName: ctx.firmName, blockers: verdict.blockers, amount, checks: o.checks });
    if (restingToday && verdict.decision === "firm_review") summary.plain = RESTING_PLAIN;
    if (reviewRun) summary.technical += ` Reviewers: ${reviewRun.summary.technical}`;
    if (reviewError) summary.technical += ` Reviewers unavailable: ${reviewError}`;
    if (cacheInfo.vision === "hit" || cacheInfo.reviewers === "hit") summary.technical += ` Model answers read from the verification cache (${key.slice(0, 12)}), so no model call was made for them.`;

    // Store new model answers, so the same photo for the same recall and rule costs nothing next time.
    if (cache && o.vision && (cacheInfo.vision === "live" || cacheInfo.reviewers === "live")) {
      await cache.put({
        key,
        recallNumber: recall.number,
        photoSha256: sha256,
        ruleVersion: ruleVersion(rule),
        engineVersion: engineVersion(undefined, input.options?.effort),
        decision: verdict.decision,
        result: { vision: o.vision, reviews: reviewRun?.reviews ?? cached?.result.reviews ?? null },
        source: input.options?.cacheSource ?? "live",
      });
      cacheInfo.stored = true;
    }
    timings.total_ms = ms(t0);
    return {
      decision: verdict.decision,
      decided_by: verdict.decided_by,
      checks: o.checks,
      guidance,
      summary,
      amount: amount.amount,
      quality,
      photo: { dhash: variants[0], dhash_variants: variants, width: img.width, height: img.height, exif: img.exif, mime, sha256 },
      person: person ? { visible: true, kinds: person.kinds } : null,
      review: reviewRun ? debatePayload(reviewRun) : null,
      blockers: verdict.blockers,
      model: o.vision?.model ?? reviewRun?.model ?? null,
      usage: {
        vision: cacheInfo.vision === "live" ? (o.vision?.usage ?? null) : null,
        reviewers: cacheInfo.reviewers === "live" ? (reviewRun?.reviews.map((r) => r.usage) ?? []) : [],
      },
      cache: cacheInfo,
      official: { loaded: official.images.length, failed: official.failed, sent: o.vision || reviewRun ? o.officialImgs.length : 0 },
      timings,
    };
  };

  // 2. Not their own photo, or not good enough to check: no model call needed.
  const c3Hash = evaluateC3({ dhash: variants[0], official: hashes.official, prior: hashes.prior, nearest: hashes.nearest, source: null, exif: img.exif, visionAvailable: false, elsewhere });
  if (c3Hash.kind === "official" || !quality.ok) {
    const why =
      c3Hash.kind === "official"
        ? elsewhere.official
          ? "The photo matches a picture published with another recall."
          : "The photo matches one of this recall's official images."
        : "The photo did not pass the quality precheck.";
    const checksStarted = performance.now();
    const c6 = await c6P;
    timings.checks_ms = ms(checksStarted);
    return finish({
      checks: { C1: skipped("C1", why), C2: skipped("C2", why), C3: c3Hash.kind ? c3Hash.check : skipped("C3", why), C4: skipped("C4", why), C5: c5, C6: c6 },
      ownPhoto: c3Hash.kind,
      findings: [],
      vision: null,
      officialImgs: visionImages,
    });
  }

  // 3. The cache, then the budget, then one vision call for C1 to C4, with C6 running alongside.
  let vision: VisionRun | null = null;
  let visionError: string | null = null;
  const visionStarted = performance.now();
  if (cached?.result.vision) {
    vision = { ...cached.result.vision, ms: 0, replayed: true };
    cacheInfo.vision = "hit";
  } else if (deps.vision || ai()) {
    const budget = deps.vision && !deps.overBudget ? { over: false, usd: 0, budget: Infinity } : await budgetCheck();
    if (budget.over) {
      restingToday = true;
      visionError = `The daily AI budget is spent ($${budget.usd.toFixed(2)} of $${budget.budget.toFixed(2)}, AI_DAILY_USD).`;
    } else {
      try {
        vision = await (deps.vision ?? runVision)({ photo: img.jpeg, recall, rule, official: visionImages, effort: input.options?.effort });
        cacheInfo.vision = "live";
      } catch (e) {
        visionError = (e as Error).message;
      }
    }
  } else visionError = "No ANTHROPIC_API_KEY on this server, or the AI service is paused.";
  timings.vision_ms = ms(visionStarted);

  const checksStarted = performance.now();
  const c6 = await c6P;
  if (!vision) {
    const why = `Vision unavailable: ${visionError}`;
    const c3 = evaluateC3({ dhash: variants[0], official: null, prior: hashes.prior, nearest: hashes.nearest, source: null, exif: img.exif, visionAvailable: false, elsewhere: { official: null, prior: elsewhere.prior } });
    let checks: Checks = { C1: unavailable("C1", why), C2: unavailable("C2", why), C3: c3.check, C4: evaluateC4({ rule, recall, identifiers: null }), C5: c5, C6: c6 };
    if (restingToday) checks = resting(checks);
    timings.checks_ms = ms(checksStarted);
    return finish({ checks, ownPhoto: c3.kind, findings: [], vision: null, officialImgs: visionImages });
  }
  const r = vision.report;
  const c2 = evaluateC2(r, rule);
  const c3 = evaluateC3({ dhash: variants[0], official: null, prior: hashes.prior, nearest: hashes.nearest, source: r.photo_source, exif: img.exif, visionAvailable: true, elsewhere: { official: null, prior: elsewhere.prior } });
  const { findings, ...c2Check } = c2;
  const checks: Checks = { C1: evaluateC1(r), C2: c2Check, C3: c3.check, C4: evaluateC4({ rule, recall, identifiers: r.identifiers }), C5: c5, C6: c6 };
  timings.checks_ms = ms(checksStarted);
  return finish({ checks, ownPhoto: c3.kind, findings, vision, tip: r.retake_tip || undefined, officialImgs: visionImages });
}
