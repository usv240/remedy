import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withPhotoCount } from "@/app/api/claims/_lib/recall";
import { photoAsk } from "@/lib/recall/photo-count";
import { verifyPhoto } from "@/lib/verify";
import { fixtureFile, loadFixtureRecalls } from "@/lib/verify/fixtures";
import { visionContent, type VisionArgs, type VisionRun } from "@/lib/verify/vision";
import type { VisionReport } from "@/lib/verify/vision-schema";

/**
 * Remedies that ask for two or three photos: the count is read from the remedy text in code, the claim takes that
 * many, every photo gets the free checks, and all of them go to the model in one request. The model is stubbed.
 */
const recalls = loadFixtureRecalls();
const powerBank = recalls["27056"];

describe("how many photos a remedy asks for", () => {
  it("reads two, three, and two photos named one by one, and what each one shows", () => {
    expect(photoAsk("submit two photos: one photo of both straps cut off and one photo of the helmet and cut straps inside of a trash can. Send both photos")).toEqual({
      count: 2,
      shows: ["both straps cut off", "the helmet and cut straps inside of a trash can"],
    });
    expect(photoAsk("fill out an online form and submit three photographs; one should be of the door").count).toBe(3);
    expect(photoAsk("submit a picture of the 12-digit UPC code printed on the label and a picture of the date code printed on the side of the bottle and dispose of the product").shows).toEqual(["the 12-digit UPC code printed on the label", "the date code printed on the side of the bottle"]);
    expect(photoAsk("email a photo of the product with RECALLED written on it")).toEqual({ count: 1, shows: [] });
    expect(photoAsk(null).count).toBe(1);
  });

  it("counts the photo-refund remedies that ask for more than one, from the CPSC data", () => {
    const data = JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "recalls.json"), "utf8")) as { recalls: { number: string; photoRefund: boolean; remedyText: string }[] };
    const multi = data.recalls.filter((r) => r.photoRefund && photoAsk(r.remedyText).count > 1).map((r) => r.number);
    expect(multi).toContain("25007");
    expect(multi.length).toBeGreaterThanOrEqual(7);
  });

  it("adds the count only to a rule that asks for more than one, so every one-photo rule stays as it was", () => {
    const rule = { actions: ["cut_cord"], must_show: ["whole_product"] };
    expect(withPhotoCount(rule, "email a photo of the cut cord")).toBe(rule);
    expect(withPhotoCount(rule, "submit two photos of the product")).toMatchObject({ photo_count: 2 });
  });
});

const report = (): VisionReport => ({
  scene: "A black power bank with RECALLED written on the front.",
  product: { match_score: 0.93, matching_details: ["20W print"], differing_details: [], reason_plain: "Same case.", reason_technical: "Matches image 1." },
  actions: [{ action: "write_recalled", done: true, confidence: 0.95, evidence: "RECALLED across the front" }],
  handwritten_text: [{ text: "RECALLED", on_product: true, where: "across the front" }],
  identifiers: { model_text: null, lot_text: null, date_code_text: null, label_visible: false, where: null },
  photo_source: { kind: "camera_photo", signs: ["none"], confidence: 0.9, reason: "Camera noise." },
  retake_tip: "",
  person: { visible: false, kinds: [], where: "" },
});

describe("a claim with two photos", () => {
  const photo = fixtureFile("other/commons-coffee-in-a-mug.jpg");
  const second = fixtureFile("other/commons-powerbank-romoss.jpg");
  const ctx = { firmAmount: { value: "20.00", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } };

  it("sends both photos to the model in one request, labelled in order", async () => {
    const vision = vi.fn(async (a: VisionArgs): Promise<VisionRun> => ({ report: report(), model: "claude-opus-5-5", ms: 1, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...(a ? {} : {}) }));
    const rule = { ...powerBank.rule, photo_count: 2, photo_shows: ["the front with RECALLED", "the model label"] };
    const r = await verifyPhoto({ photo, morePhotos: [second], recall: powerBank.recall, proofRule: rule, claimContext: ctx }, { aiAvailable: () => true, vision, reviewers: vi.fn() });
    expect(vision).toHaveBeenCalledTimes(1);
    const args = vision.mock.calls[0][0];
    expect(args.more).toHaveLength(1);
    expect(r.more_photos).toHaveLength(1);
    const text = visionContent(args)
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
    expect(text).toContain("The owner's 2 photos");
    expect(text).toContain("The owner's photo 2 of 2, which the remedy asks to show the model label:");
    expect(visionContent(args).filter((b) => b.type === "image").length).toBeGreaterThanOrEqual(2);
  });

  it("asks for the owner's own photo when the second one is the recall's official picture, with no model call", async () => {
    const vision = vi.fn();
    const r = await verifyPhoto({ photo, morePhotos: [fixtureFile("official/27056-haiara-1.jpg")], recall: powerBank.recall, proofRule: { ...powerBank.rule, photo_count: 2 }, claimContext: ctx }, { aiAvailable: () => true, vision, reviewers: vi.fn() });
    expect(vision).not.toHaveBeenCalled();
    expect(r.decision).toBe("retake");
    expect(r.decided_by).toBe("own_photo");
  });

  it("asks for a new photo when the second one is blurry", async () => {
    const vision = vi.fn();
    const r = await verifyPhoto({ photo, morePhotos: [fixtureFile("derived/commons-coffee-in-a-mug.blur8.jpg")], recall: powerBank.recall, proofRule: { ...powerBank.rule, photo_count: 2 }, claimContext: ctx }, { aiAvailable: () => true, vision, reviewers: vi.fn() });
    expect(vision).not.toHaveBeenCalled();
    expect(r.decision).toBe("retake");
    expect(r.decided_by).toBe("quality");
  });

  it("leaves a one-photo request exactly as it was", () => {
    const one = visionContent({ photo: Buffer.from([1]), recall: powerBank.recall, rule: powerBank.rule, official: [] });
    expect(one.some((b) => b.type === "text" && (b as { text: string }).text === "The owner's photo:")).toBe(true);
  });
});
