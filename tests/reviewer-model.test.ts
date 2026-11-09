import { describe, expect, it } from "vitest";
import { MODEL } from "@/lib/ai/claude";
import { loadFixtureRecalls } from "@/lib/verify/fixtures";
import { REVIEWER_MODEL_ENV, reviewerModel, reviewParams } from "@/lib/verify/reviewers";

/**
 * Each reviewer's model is a setting (REMEDY_REVIEWER_MODEL_PRODUCT, REMEDY_REVIEWER_MODEL_REMEDY), defaulting to the
 * claim path's model. The setting is honoured by the exact request the live call sends. No network.
 */
const { recall, rule } = loadFixtureRecalls()["27056"];
const args = { photo: Buffer.alloc(0), recall, rule, official: [] };

describe("the reviewers' models are a configuration", () => {
  it("default to the claim path's model", () => {
    expect(reviewerModel("product", {})).toBe(MODEL);
    expect(reviewerModel("remedy", {})).toBe(MODEL);
    expect(reviewerModel("product", { [REVIEWER_MODEL_ENV.product]: "   " })).toBe(MODEL);
  });

  it("put one reviewer on another model family when its setting names one, leaving the other as it was", () => {
    const env = { [REVIEWER_MODEL_ENV.product]: "another-vendor-model-1" };
    expect(reviewerModel("product", env)).toBe("another-vendor-model-1");
    expect(reviewerModel("remedy", env)).toBe(MODEL);
  });

  it("is honoured by the request each reviewer sends", () => {
    const before = process.env[REVIEWER_MODEL_ENV.remedy];
    process.env[REVIEWER_MODEL_ENV.remedy] = "claude-sonnet-5-5";
    try {
      expect(reviewParams("remedy", args).model).toBe("claude-sonnet-5-5");
      expect(reviewParams("product", args).model).toBe(MODEL);
      // A sweep's explicit model still wins over the setting.
      expect(reviewParams("remedy", { ...args, model: "claude-haiku-5-5" }).model).toBe("claude-haiku-5-5");
    } finally {
      if (before === undefined) delete process.env[REVIEWER_MODEL_ENV.remedy];
      else process.env[REVIEWER_MODEL_ENV.remedy] = before;
    }
  });

  it("is documented where the setting is read, and in .env.example", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/lib/verify/reviewers.ts", ".env.example", "docs/research.md"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain(REVIEWER_MODEL_ENV.product);
      expect(text, file).toContain(REVIEWER_MODEL_ENV.remedy);
    }
    // /evidence/market#problem prints the two setting names from this module rather than typing them in.
    expect(readFileSync("src/app/evidence/market/page.tsx", "utf8")).toContain("REVIEWER_MODEL_ENV.product");
  });
});
