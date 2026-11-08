import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replayable } from "@/lib/ai/claude";
import { costUsd, dailyBudgetUsd, logUsage, overBudget, resetMemorySpend, RESTING_PLAIN, spendToday } from "@/lib/ai/usage";
import { cacheKey, engineVersion, memoryVerifyCache, photoSha256, ruleVersion } from "@/lib/verify/cache";
import { fixtureFile, loadFixtureRecalls } from "@/lib/verify/fixtures";
import { claimMaxSide, decodeImage, visualTokens } from "@/lib/verify/image";
import { pickForVision } from "@/lib/verify/official";
import { allowUpload, resetMemoryLimits } from "@/lib/ratelimit";
import { verifyPhoto } from "@/lib/verify";
import type { VisionRun } from "@/lib/verify/vision";
import type { VisionReport } from "@/lib/verify/vision-schema";

// The free cost wins: local replay, the verification cache, image sizes, the spend guard and the usage log. No network.

const recalls = loadFixtureRecalls();
const powerBank = recalls["27056"];
const photo = fixtureFile("other/commons-coffee-in-a-mug.jpg");

const report: VisionReport = {
  scene: "A black power bank with RECALLED written on it.",
  product: { match_score: 0.93, matching_details: ["20W on the front"], differing_details: [], reason_plain: "Same case.", reason_technical: "Matches image 1." },
  actions: [{ action: "write_recalled", done: true, confidence: 0.95, evidence: "front" }],
  handwritten_text: [{ text: "RECALLED", on_product: true, where: "front" }],
  identifiers: { model_text: null, lot_text: null, date_code_text: null, label_visible: false, where: null },
  photo_source: { kind: "camera_photo", signs: ["none"], confidence: 0.9, reason: "Camera noise." },
  retake_tip: "",
  person: { visible: false, kinds: [], where: "" },
};
const visionRun: VisionRun = { report, model: "claude-opus-5-5", ms: 1, usage: { input_tokens: 4000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };

describe("local replay (AI_CACHE_DIR)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "remedy-replay-"));
  afterEach(() => {
    delete process.env.AI_CACHE_DIR;
  });

  it("calls through when AI_CACHE_DIR is unset", async () => {
    // Unset here too: a run with .env.local loaded starts with it set, and would replay instead.
    delete process.env.AI_CACHE_DIR;
    const call = vi.fn(async () => ({ n: 1 }));
    await replayable({ a: 1 }, call);
    await replayable({ a: 1 }, call);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("answers an identical request from disk, and any change is a new request", async () => {
    process.env.AI_CACHE_DIR = dir;
    const call = vi.fn(async () => ({ n: Math.random() }));
    const first = await replayable({ model: "m", messages: ["hi"] }, call);
    const again = await replayable({ model: "m", messages: ["hi"] }, call);
    expect(again).toEqual(first);
    expect(call).toHaveBeenCalledTimes(1);
    await replayable({ model: "m", messages: ["hi!"] }, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(readdirSync(dir)).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("cost of a call", () => {
  it("prices each meter at the published rates", () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write (5 minutes), per million.
    expect(costUsd("claude-opus-5-5", { input_tokens: 1e6 })).toBeCloseTo(4);
    expect(costUsd("claude-opus-5-5", { output_tokens: 1e6 })).toBeCloseTo(20);
    expect(costUsd("claude-opus-5-5", { cache_read_input_tokens: 1e6 })).toBeCloseTo(0.2);
    expect(costUsd("claude-opus-5-5", { cache_creation_input_tokens: 1e6 })).toBeCloseTo(5);
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e6 })).toBeCloseTo(12);
    // Haiku 5.5: $0.10 in, $0.50 out up to 100,000 prompt tokens; $0.50 and $2.50 above.
    expect(costUsd("claude-haiku-5-5", { input_tokens: 50_000, output_tokens: 50_000 })).toBeCloseTo(0.03, 6);
    expect(costUsd("claude-haiku-5-5", { input_tokens: 1e6, output_tokens: 1e6 })).toBeCloseTo(3);
    expect(costUsd("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 }, { batch: true })).toBeCloseTo(12);
    expect(costUsd("claude-haiku-5-5", { input_tokens: 200_000 })).toBeCloseTo(0.1, 5);
    expect(costUsd("claude-opus-5-5", null)).toBe(0);
  });
});

describe("spend guard", () => {
  afterEach(() => resetMemorySpend());

  it("defaults to $2 a day when hosted and no limit on a local machine", () => {
    expect(dailyBudgetUsd({ RENDER: "true" })).toBe(5);
    expect(dailyBudgetUsd({})).toBe(Number.POSITIVE_INFINITY);
    expect(dailyBudgetUsd({ AI_DAILY_USD: "0.5", RENDER: "true" })).toBe(0.5);
    expect(dailyBudgetUsd({ AI_DAILY_USD: "nope" })).toBe(Number.POSITIVE_INFINITY);
  });

  it("adds up today's logged spend and stops at the budget", async () => {
    const env = { ...process.env };
    delete process.env.DATABASE_URL;
    process.env.AI_DAILY_USD = "0.05";
    try {
      await logUsage({ route: "test", model: "claude-opus-5-5", usage: { input_tokens: 4000, output_tokens: 1500 } });
      expect((await spendToday()).usd).toBeCloseTo(0.046, 3);
      expect((await overBudget()).over).toBe(false);
      await logUsage({ route: "test", model: "claude-opus-5-5", usage: { output_tokens: 500 } });
      expect((await overBudget()).over).toBe(true);
    } finally {
      process.env = env;
    }
  });

  it("hands the claim to a person with a kind line once the budget is spent, and makes no model call", async () => {
    const vision = vi.fn(async () => visionRun);
    const r = await verifyPhoto({ photo, recall: powerBank.recall, proofRule: powerBank.rule }, { aiAvailable: () => true, vision, overBudget: async () => ({ over: true, usd: 2.01, budget: 2 }) });
    expect(vision).not.toHaveBeenCalled();
    expect(r.decision).toBe("firm_review");
    expect(r.checks.C1.reason_plain).toBe(RESTING_PLAIN);
    expect(r.summary.plain).toBe("Our photo checker is resting for today; a person at the firm will look.");
  });
});

describe("verification cache", () => {
  it("keys on photo bytes, recall, rule version and engine version", () => {
    const base = { photoSha256: photoSha256(photo), recallNumber: "27056", ruleVersion: ruleVersion(powerBank.rule), engineVersion: engineVersion() };
    const k = cacheKey(base);
    expect(cacheKey({ ...base })).toBe(k);
    expect(cacheKey({ ...base, recallNumber: "27045" })).not.toBe(k);
    expect(cacheKey({ ...base, photoSha256: photoSha256(Buffer.concat([photo, Buffer.from([0])])) })).not.toBe(k);
    expect(cacheKey({ ...base, ruleVersion: ruleVersion({ ...powerBank.rule, marker_text: "RECALL" }) })).not.toBe(k);
    expect(engineVersion("claude-opus-5-5", "low")).not.toBe(engineVersion());
    expect(engineVersion()).toMatch(/^[0-9a-f]{12}:claude-opus-5-5:medium$/);
  });

  it("answers the same photo for the same recall with no model call, and still re-runs the claim checks", async () => {
    const cache = memoryVerifyCache();
    const vision = vi.fn(async () => visionRun);
    const ctx = { firmAmount: { value: "34.99", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } };
    const first = await verifyPhoto({ photo, recall: powerBank.recall, proofRule: powerBank.rule, claimContext: ctx }, { aiAvailable: () => true, vision, cache });
    expect(first.decision).toBe("verified");
    expect(first.cache).toMatchObject({ vision: "live", stored: true });
    expect(cache.entries.size).toBe(1);

    const again = await verifyPhoto({ photo, recall: powerBank.recall, proofRule: powerBank.rule, claimContext: ctx }, { aiAvailable: () => true, vision, cache });
    expect(vision).toHaveBeenCalledTimes(1);
    expect(again.cache.vision).toBe("hit");
    expect(again.decision).toBe("verified");
    expect(again.usage.vision).toBeNull();

    // A second owner sending the same photo: the stored answer is reused, but the earlier-claim check still runs.
    const second = await verifyPhoto(
      { photo, recall: powerBank.recall, proofRule: powerBank.rule, claimContext: ctx, priorHashes: [{ ref: "claim_1", dhash: first.photo.dhash! }] },
      { aiAvailable: () => true, vision, cache, reviewers: async () => Promise.reject(new Error("no reviewers in this test")) },
    );
    expect(vision).toHaveBeenCalledTimes(1);
    expect(second.checks.C3.status).toBe("fail");
    expect(second.decision).toBe("firm_review");
  });

  it("does not store anything when vision did not run", async () => {
    const cache = memoryVerifyCache();
    await verifyPhoto({ photo, recall: powerBank.recall, proofRule: powerBank.rule }, { aiAvailable: () => false, cache });
    expect(cache.entries.size).toBe(0);
  });
});

describe("image sizes sent to Claude", () => {
  it("counts visual tokens as the docs do", () => {
    expect(visualTokens(1000, 1000)).toBe(1296);
    expect(visualTokens(1092, 1092)).toBe(1521);
    expect(visualTokens(1280, 960)).toBe(46 * 35);
  });

  it("sends the claim photo at 1,280 px, or 1,568 px when a label must be read", async () => {
    expect(claimMaxSide(["whole_product", "marking"])).toBe(1280);
    expect(claimMaxSide(["whole_product", "model_number"])).toBe(1568);
    const big = await (await import("sharp")).default(photo).resize(4032, 3024).jpeg().toBuffer();
    const d = await decodeImage(big, claimMaxSide(["marking"]));
    const meta = await (await import("sharp")).default(d.jpeg).metadata();
    expect([meta.width, meta.height]).toEqual([1280, 960]);
  });

  it("shows Claude two official images, product views first", () => {
    const imgs = [{ caption: "Product Packaging Label with Model Number" }, { caption: "Recalled helmet, top view" }, { caption: "Example of photo with straps cut off" }, { caption: "Side view" }];
    expect(pickForVision(imgs).map((i) => i.caption)).toEqual(["Recalled helmet, top view", "Side view"]);
    expect(pickForVision([{ caption: "Hair dryer with the power cord cut in half for disposal" }])).toHaveLength(1);
  });
});

describe("try upload limits", () => {
  afterEach(() => resetMemoryLimits());

  it("allows a few uploads per visitor, then asks them to wait", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 6; i++) expect((await allowUpload("203.0.113.9", now + i)).ok).toBe(true);
    const seventh = await allowUpload("203.0.113.9", now + 10);
    expect(seventh.ok).toBe(false);
    if (!seventh.ok) expect(seventh.plain).toContain("try one of our sample photos");
    expect((await allowUpload("198.51.100.7", now + 10)).ok).toBe(true);
    expect((await allowUpload("203.0.113.9", now + 11 * 60_000)).ok).toBe(true);
  });

  it("caps a visitor at 30 a day", async () => {
    const limits = { perWindow: 100, windowMs: 1000, perDay: 30, dayMs: 86_400_000 };
    for (let i = 0; i < 30; i++) expect((await allowUpload("192.0.2.1", i * 2000, limits)).ok).toBe(true);
    expect((await allowUpload("192.0.2.1", 70_000, limits)).ok).toBe(false);
  });
});
