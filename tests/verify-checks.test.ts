import { describe, expect, it } from "vitest";
import { computeAmount, evaluateC4, evaluateC5, evaluateC6, markerMatches, toCents } from "@/lib/verify/checks";
import { decide } from "@/lib/verify/decide";
import { extractModels, extractRanges, inRange, knownModels, knownRanges, matchModel, normalizeDateCode, parseUnits } from "@/lib/verify/identifiers";
import { loadFixtureRecalls } from "@/lib/verify/fixtures";
import { referee, type ReviewInput } from "@/lib/verify/reviewers";
import type { CheckResult, Checks, QualityReport, VerifyProofRule, VerifyRecall } from "@/lib/verify/types";
import type { Recall } from "@/lib/recall/types";
import type { ProofRule } from "@/lib/recall/proof-rule";

// Contract with the data builder: a stored recall and proof rule can be passed to verifyPhoto as they are.
export const recallFits = (r: Recall): VerifyRecall => r;
export const ruleFits = (r: ProofRule): VerifyProofRule => r;
import type { VisionReport } from "@/lib/verify/vision-schema";

// Deterministic checks (C4, C5, C6), money, the decision table and the referee. No model, no network.

const recalls = loadFixtureRecalls();
const heater = recalls["27054"].recall;
const powerBank = recalls["27056"].recall;
const ids = (over: Partial<VisionReport["identifiers"]> = {}): VisionReport["identifiers"] => ({ model_text: null, lot_text: null, date_code_text: null, label_visible: true, where: "label", ...over });
const rule = (must_show: VerifyProofRule["must_show"]): VerifyProofRule => ({ actions: ["cut_cord"], must_show });

describe("reading the recall's models and ranges", () => {
  it("finds model numbers in real CPSC text", () => {
    expect(knownModels(heater)).toContain("DR-HSH015");
    expect(knownModels(powerBank)).toContain("W5 PRO");
    expect(extractModels("The recall involves models 1234, 5678 and AB-90. Model numbers are printed on the base.")).toEqual(["1234", "5678", "AB-90"]);
    expect(extractModels("Model numbers are printed on the base.")).toEqual([]);
  });

  it("reads the DREO manufacture window as a YYYY-MM range, but not a sales window", () => {
    expect(knownRanges(heater)).toEqual([expect.objectContaining({ kind: "date_code", from: "2025-04", to: "2026-01" })]);
    expect(extractRanges("They were sold at Target from April 2025 through January 2026.")).toEqual([]);
    expect(extractRanges("Lot numbers 240101 through 240330 are included.")).toEqual([expect.objectContaining({ kind: "lot", from: "240101", to: "240330" })]);
  });

  it("normalizes date codes in the formats labels use", () => {
    expect(normalizeDateCode("2025/08")).toBe("2025-08");
    expect(normalizeDateCode("08/2025")).toBe("2025-08");
    expect(normalizeDateCode("20250815")).toBe("2025-08");
    expect(normalizeDateCode("MFG Date: 2025.11")).toBe("2025-11");
    expect(normalizeDateCode("Aug 2025")).toBe("2025-08");
    expect(normalizeDateCode("2025/13")).toBeNull();
    expect(normalizeDateCode("ABC")).toBeNull();
  });

  it("matches models exactly after normalizing, or with a short variant suffix", () => {
    expect(matchModel("Model: DR-HSH015", ["DR-HSH015"])).toEqual({ model: "DR-HSH015", exact: true });
    expect(matchModel("dr hsh015", ["DR-HSH015"])?.exact).toBe(true);
    expect(matchModel("DR-HSH015B", ["DR-HSH015"])?.exact).toBe(false);
    expect(matchModel("DR-HSH016", ["DR-HSH015"])).toBeNull();
    expect(matchModel("DR-HSH0150000", ["DR-HSH015"])).toBeNull();
  });

  it("compares a read value with a range, or says it cannot", () => {
    const dates = { kind: "date_code" as const, from: "2025-04", to: "2026-01" };
    expect(inRange("2025/08", dates)).toBe(true);
    expect(inRange("2026/03", dates)).toBe(false);
    expect(inRange("Lot 7", dates)).toBeNull();
    expect(inRange("240215", { kind: "lot", from: "240101", to: "240330" })).toBe(true);
    expect(inRange("A0099", { kind: "lot", from: "A0100", to: "A0199" })).toBe(false);
  });

  it("parses CPSC unit counts", () => {
    expect(parseUnits("About 338,800 (In addition, about 36,300 were sold in Canada)")).toBe(338800);
    expect(parseUnits("About 1.2 million")).toBe(1_200_000);
    expect(parseUnits(300)).toBe(300);
    expect(parseUnits("Unknown")).toBeNull();
  });
});

describe("C4 within the recall", () => {
  it("passes when no identifier is required and nothing read conflicts", () => {
    expect(evaluateC4({ rule: rule([]), recall: heater, identifiers: ids() }).status).toBe("pass");
  });

  it("passes a recalled model and a date inside the window", () => {
    const c = evaluateC4({ rule: rule(["model_number", "date_code"]), recall: heater, identifiers: ids({ model_text: "DR-HSH015", date_code_text: "2025/08" }) });
    expect(c.status).toBe("pass");
  });

  it("fails a model that is not recalled, even when the rule did not ask for it", () => {
    const c = evaluateC4({ rule: rule([]), recall: heater, identifiers: ids({ model_text: "DR-HSH022" }) });
    expect(c.status).toBe("fail");
    expect(c.reason_plain).toBe("Model DR-HSH022 is not one of the recalled models.");
  });

  it("fails a date outside the window", () => {
    expect(evaluateC4({ rule: rule(["date_code"]), recall: heater, identifiers: ids({ date_code_text: "2026/03" }) }).status).toBe("fail");
  });

  it("is unclear when a required identifier cannot be read", () => {
    const c = evaluateC4({ rule: rule(["model_number"]), recall: heater, identifiers: ids() });
    expect(c.status).toBe("unclear");
    expect(c.reason_plain).toBe("We could not read the model number.");
  });

  it("needs vision only when the rule asks for an identifier", () => {
    expect(evaluateC4({ rule: rule(["model_number"]), recall: heater, identifiers: null }).status).toBe("unavailable");
    expect(evaluateC4({ rule: rule([]), recall: heater, identifiers: null }).status).toBe("pass");
  });
});

describe("C5 claim limits", () => {
  it("allows one claim per unit purchased, default 1", () => {
    expect(evaluateC5({}, powerBank).status).toBe("pass");
    expect(evaluateC5({ payeeClaimCount: 1 }, powerBank).status).toBe("fail");
    expect(evaluateC5({ payeeClaimCount: 1, unitsPurchased: 2 }, powerBank).status).toBe("pass");
    expect(evaluateC5({ payeeClaimCount: 2, unitsPurchased: 2 }, powerBank).reason_plain).toContain("can approve more with a receipt");
  });

  it("caps total claims at the recall's units", () => {
    expect(evaluateC5({ recallClaimCount: 10_999 }, powerBank).status).toBe("pass");
    expect(evaluateC5({ recallClaimCount: 11_000 }, powerBank).status).toBe("fail");
    expect(evaluateC5({ recallClaimCount: 5, recallUnits: 5 }, powerBank).status).toBe("fail");
  });
});

describe("C6 not already refunded", () => {
  it("passes with no PayPal purchase linked", async () => {
    expect(await evaluateC6({})).toMatchObject({ status: "pass", reason_plain: "No PayPal purchase linked." });
  });

  it("uses the payments lookup, and goes to a person when it is missing or fails", async () => {
    const linkedCapture = { id: "CAP", amount: { value: "10.00", currency: "USD" } };
    expect((await evaluateC6({ linkedCapture, hasPriorRefund: async () => ({ refunded: false }) })).status).toBe("pass");
    expect((await evaluateC6({ linkedCapture, hasPriorRefund: async () => ({ refunded: false, disputed: true }) })).status).toBe("fail");
    expect((await evaluateC6({ linkedCapture })).status).toBe("unclear");
    expect(
      (
        await evaluateC6({
          linkedCapture,
          hasPriorRefund: async () => {
            throw new Error("timeout");
          },
        })
      ).status,
    ).toBe("unclear");
  });
});

describe("money", () => {
  it("parses exact cents and rejects anything else", () => {
    expect(toCents({ value: "34.99", currency: "USD" })).toBe(3499);
    expect(toCents({ value: "5", currency: "USD" })).toBe(500);
    expect(toCents({ value: "0.1", currency: "USD" })).toBe(10);
    for (const bad of ["-1.00", "1.999", "abc", "1e3", ""]) expect(toCents({ value: bad, currency: "USD" }), bad).toBeNull();
  });

  it("refunds the lower of firm and capture, and flags the cap", () => {
    const a = computeAmount({ firmAmount: { value: "34.99", currency: "USD" }, linkedCapture: { id: "C", amount: { value: "40.00", currency: "USD" } }, autoCap: { value: "30.00", currency: "USD" } });
    expect(a.amount).toMatchObject({ value: "34.99", source: "firm" });
    expect(a.overCap).toBe(true);
    expect(computeAmount({ autoCap: { value: "30.00", currency: "USD" } }).missing).toBe(true);
    expect(computeAmount({})).toMatchObject({ amount: null, overCap: false, missing: false });
    expect(computeAmount({ firmAmount: { value: "30.00", currency: "USD" }, autoCap: { value: "30.00", currency: "USD" } }).overCap).toBe(false);
  });
});

describe("marker text", () => {
  it("is read exactly, ignoring case", () => {
    expect(markerMatches("recalled", "RECALLED")).toBe(true);
    expect(markerMatches("  Recalled. ", "RECALLED")).toBe(true);
    expect(markerMatches("RECALLED 11/5", "recalled")).toBe(true);
    expect(markerMatches("RECALL", "RECALLED")).toBe(false);
    expect(markerMatches("RECALED", "RECALLED")).toBe(false);
    expect(markerMatches("UNRECALLED", "RECALLED")).toBe(false);
  });
});

describe("decision table", () => {
  const pass = (id: CheckResult["id"]): CheckResult => ({ id, name: id, pass: true, status: "pass", reason_plain: "", reason_technical: "" });
  const all = (over: Partial<Checks> = {}): Checks => ({ C1: pass("C1"), C2: pass("C2"), C3: pass("C3"), C4: pass("C4"), C5: pass("C5"), C6: pass("C6"), ...over });
  const with_ = (id: CheckResult["id"], status: CheckResult["status"]) => all({ [id]: { ...pass(id), pass: false, status } });
  const good: QualityReport = { ok: true, issues: [], metrics: { width: 1000, height: 800, sharpness: 200, laplacianVariance: 100, meanLuma: 120, p95Luma: 200, p05Luma: 30 } };
  const blurry: QualityReport = { ...good, ok: false, issues: ["blurry"] };
  const noMoney = computeAmount({});
  const overCap = computeAmount({ firmAmount: { value: "80.00", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } });
  const d = (checks: Checks, o: Partial<Parameters<typeof decide>[0]> = {}) => decide({ quality: good, checks, ownPhoto: null, amount: noMoney, ...o });

  it("verifies only when all six pass and the amount is within the cap", () => {
    expect(d(all()).decision).toBe("verified");
    expect(d(all(), { amount: overCap }).decision).toBe("firm_review");
  });

  it("asks for a retake when C2 fails or quality is low, and for their own photo first", () => {
    expect(d(with_("C2", "fail")).decision).toBe("retake");
    expect(d(all(), { quality: blurry })).toMatchObject({ decision: "retake", decided_by: "quality" });
    expect(d(with_("C3", "fail"), { quality: blurry, ownPhoto: "official" })).toMatchObject({ decision: "retake", decided_by: "own_photo" });
    expect(d(with_("C3", "fail"), { ownPhoto: "screen" }).decided_by).toBe("own_photo");
  });

  it("sends everything in between to the firm", () => {
    for (const [id, status] of [["C1", "unclear"], ["C1", "fail"], ["C3", "fail"], ["C4", "fail"], ["C4", "unclear"], ["C5", "fail"], ["C6", "unclear"], ["C2", "unavailable"]] as const) {
      expect(d(with_(id, status)).decision, `${id} ${status}`).toBe("firm_review");
    }
  });

  it("lets agreeing reviewers settle only judgement calls", () => {
    const agree = { decision: "verify" as const, agreed: true };
    expect(d(with_("C1", "unclear"), { review: agree })).toMatchObject({ decision: "verified", decided_by: "reviewers" });
    expect(d(with_("C4", "unclear"), { review: agree }).decision).toBe("verified");
    expect(d(with_("C1", "fail"), { review: agree }).decision).toBe("firm_review");
    expect(d(with_("C5", "fail"), { review: agree }).decision).toBe("firm_review");
    expect(d(with_("C1", "unclear"), { review: agree, amount: overCap }).decision).toBe("firm_review");
    expect(d(with_("C1", "unclear"), { review: { decision: "person", agreed: false } }).decision).toBe("firm_review");
  });
});

describe("referee", () => {
  const ctx = recalls["27056"];
  const refCtx = { recall: ctx.recall, rule: ctx.rule };
  const v = (reviewer: "product" | "remedy", over: Partial<ReviewInput> = {}): ReviewInput => ({
    reviewer,
    answer: "meets",
    evidence: [{ check: reviewer === "product" ? "right_product" : "made_safe", seen: reviewer === "product" ? "black case with 20W printed on the front" : "RECALLED in black marker", where: "front of the case" }],
    model_read: null,
    marker_text_read: reviewer === "remedy" ? "RECALLED" : null,
    reason_plain: "",
    reason_technical: "",
    confidence: 0.9,
    ...over,
  });

  it("verifies only when both counted votes say it meets the recall", () => {
    expect(referee([v("product"), v("remedy")], refCtx)).toMatchObject({ decision: "verify", agreed: true });
    expect(referee([v("product", { answer: "does_not_meet" }), v("remedy")], refCtx)).toMatchObject({ decision: "person", agreed: false });
    expect(referee([v("product", { answer: "does_not_meet" }), v("remedy", { answer: "does_not_meet" })], refCtx)).toMatchObject({ decision: "person", agreed: true });
    expect(referee([v("product", { answer: "unclear" }), v("remedy")], refCtx).decision).toBe("person");
  });

  it("sets aside votes whose evidence does not check out", () => {
    const noEvidence = referee([v("product", { evidence: [] }), v("remedy")], refCtx);
    expect(noEvidence.decision).toBe("person");
    expect(noEvidence.votes[0].setAsideReason).toBe("It did not say what it saw in the photo.");
    const vague = referee([v("product", { evidence: [{ check: "right_product", seen: "it", where: "x" }] }), v("remedy")], refCtx);
    expect(vague.votes[0].counted).toBe(false);
    const wrongWord = referee([v("product"), v("remedy", { marker_text_read: "RECALL" })], refCtx);
    expect(wrongWord.votes[1].setAsideReason).toContain("is not RECALLED");
    const wrongModel = referee([v("product", { model_read: "X9 MAX" }), v("remedy")], refCtx);
    expect(wrongModel.votes[0].setAsideReason).toContain("X9 MAX");
    const unsure = referee([v("product", { confidence: 0.4 }), v("remedy")], refCtx);
    expect(unsure.decision).toBe("person");
  });

  it("explains the outcome in plain words", () => {
    expect(referee([v("product"), v("remedy")], refCtx).summary.plain).toBe("Both reviewers found it in the photo: this is the recalled product, made safe.");
    expect(referee([v("product", { answer: "does_not_meet" }), v("remedy")], refCtx).summary.plain).toBe("The reviewers read the photo differently, so a person at the firm will look.");
  });
});
