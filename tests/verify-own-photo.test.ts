import { describe, expect, it } from "vitest";
import { computeAmount, CONTRADICTING_SIGNS, evaluateC3 } from "@/lib/verify/checks";
import { decide } from "@/lib/verify/decide";
import type { CheckResult, Checks, QualityReport } from "@/lib/verify/types";
import type { VisionReport } from "@/lib/verify/vision-schema";

type Source = VisionReport["photo_source"];
const c3 = (source: Source) =>
  evaluateC3({ dhash: "0000000000000000", official: null, prior: null, nearest: { official: null, prior: null }, source, exif: false, visionAvailable: true });

describe("C3: the model's own signs against its label", () => {
  it("does not take a 'camera photo' with screen signs as the owner's own (the 2026-11-06 photo of a monitor)", () => {
    const r = c3({ kind: "camera_photo", confidence: 0.75, signs: ["screen_bezel", "screen_glare", "app_or_web_ui"], reason: "A desktop with icons, photographed." });
    expect(CONTRADICTING_SIGNS).toBe(2);
    expect(r.check.status).toBe("unclear");
    expect(r.check.reason_technical).toMatch(/3 screen signs disagree with the label camera_photo/);
  });

  it("does the same for printout signs", () => {
    expect(c3({ kind: "unsure", confidence: 0.5, signs: ["paper_texture", "halftone_dots"], reason: "" }).check.status).toBe("unclear");
  });

  it("keeps a camera photo with one sign, or none, as the owner's own", () => {
    // A recorded owner-style photo read with paper_texture alone was paid; one sign is not enough to doubt it.
    expect(c3({ kind: "camera_photo", confidence: 0.9, signs: ["paper_texture"], reason: "" }).check.status).toBe("pass");
    expect(c3({ kind: "camera_photo", confidence: 0.9, signs: ["none"], reason: "" }).check.status).toBe("pass");
  });

  it("still fails a photo the model itself calls a photo of a screen", () => {
    const r = c3({ kind: "photo_of_screen", confidence: 0.85, signs: ["screen_bezel", "screen_glare", "app_or_web_ui"], reason: "" });
    expect(r).toMatchObject({ kind: "screen", check: { status: "fail" } });
  });

  it("an unclear own-photo check is never paid automatically", () => {
    const pass = (id: CheckResult["id"]): CheckResult => ({ id, name: id, pass: true, status: "pass", reason_plain: "", reason_technical: "" });
    const checks: Checks = { C1: pass("C1"), C2: pass("C2"), C3: { ...pass("C3"), pass: false, status: "unclear" }, C4: pass("C4"), C5: pass("C5"), C6: pass("C6") };
    const quality: QualityReport = { ok: true, issues: [], metrics: { width: 1000, height: 800, sharpness: 200, laplacianVariance: 100, meanLuma: 120, p95Luma: 200, p05Luma: 30 } };
    expect(decide({ quality, checks: { ...checks, C3: pass("C3") }, ownPhoto: null, amount: computeAmount({}) }).decision).toBe("verified");
    expect(decide({ quality, checks, ownPhoto: null, amount: computeAmount({}) }).decision).not.toBe("verified");
  });
});
