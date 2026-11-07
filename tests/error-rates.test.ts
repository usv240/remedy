import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { decisions, errorRates, knownAnswer } from "@/components/judges/errors";
import { fixtureFile, loadFixtureCases, loadFixtureRecalls } from "@/lib/verify/fixtures";

describe("known answers for money", () => {
  it("a named decision is the answer; right product and made safe means pay", () => {
    expect(knownAnswer({ decision: "verified" })).toBe("paid");
    expect(knownAnswer({ decision: "retake" })).toBe("not_paid");
    expect(knownAnswer({ not_decision: "verified" })).toBe("not_paid");
    expect(knownAnswer({ checks: { C1: "pass", C2: "pass" } }, "sample/cord-cut.jpg")).toBe("paid");
    expect(knownAnswer({ checks: { C1: "fail" } })).toBeNull();
  });

  it("a recall's own published picture is never a payment, so a reading case on it counts in neither rate", () => {
    expect(knownAnswer({ checks: { C1: "pass", C2: "pass" } }, "official/26125-hair-dryer-cord-cut.png")).toBeNull();
    // Where such a case names a decision, that decision is still its answer.
    expect(knownAnswer({ decision: "retake" }, "official/26125-hair-dryer-cord-cut.png")).toBe("not_paid");
  });
});

describe("the sample recall's photos", () => {
  const cases = loadFixtureCases().filter((c) => c.sweep === "sample");

  it("run on the sample recall, in the claim path's own shape with the firm's rule", () => {
    expect(cases.map((c) => c.id)).toEqual(["sample-charger-cut", "sample-charger-opened-cord-attached", "sample-charger-opened-case"]);
    const bh = loadFixtureRecalls()["BH-2026-01"];
    expect(bh.recall.images.length).toBeGreaterThan(0);
    expect(bh.recall.images.every((i) => i.data && i.data.length > 0)).toBe(true);
    expect(bh.rule.actions).toEqual(["cut_cord"]);
  });

  it("are credited, and stored without camera metadata", async () => {
    const credits = JSON.parse(readFileSync(path.join(process.cwd(), "content", "verify", "fixtures", "sample", "CREDITS.json"), "utf8")) as { files: Record<string, { source: string }> };
    for (const c of cases) {
      const name = c.photo.replace(/^sample\//, "");
      expect(credits.files[name]?.source).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
      const meta = await sharp(fixtureFile(c.photo)).metadata();
      expect(meta.exif).toBeUndefined();
    }
  });

  it("count in both rates at the claim path's setting, and not in the four-setting figure", () => {
    const d = decisions();
    const sample = d.all.filter((x) => x.source === "sample");
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.every((x) => cases.some((c) => c.id === x.caseId))).toBe(true);
    expect(d.allConfigs.some((x) => x.source === "sample")).toBe(false);
    const r = errorRates();
    expect(r.heldBack.of).toBeGreaterThanOrEqual(sample.filter((x) => x.known === "paid").length + 1);
    expect(r.bySource.find((b) => b.source === "sample")?.decisions).toBe(sample.length);
  });
});
