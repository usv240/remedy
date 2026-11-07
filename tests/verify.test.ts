import { describe, expect, it, vi } from "vitest";
import { dhash, referee, verifyPhoto, VISION_UNAVAILABLE, type VerifyInput } from "@/lib/verify";
import { fixtureFile, loadFixtureCases, loadFixtureRecalls, meetsExpectation } from "@/lib/verify/fixtures";
import type { ReviewInput, ReviewRun } from "@/lib/verify/reviewers";
import type { VisionRun } from "@/lib/verify/vision";
import type { VisionReport } from "@/lib/verify/vision-schema";

// The verifier's decision path end to end, with the vision step and the reviewers stubbed: no network, no key.

const recalls = loadFixtureRecalls();
const powerBank = recalls["27056"];
const heater = recalls["27054"];
// A sharp, real photo that is not an official image: stands in for "the owner's photo" while vision is stubbed.
const photo = fixtureFile("other/commons-coffee-in-a-mug.jpg");

function report(over: Partial<VisionReport> = {}): VisionReport {
  return {
    scene: "A black power bank on a table with RECALLED written on the front.",
    product: { match_score: 0.93, matching_details: ["20W printed on the front, bottom center"], differing_details: [], reason_plain: "Same black case and 20W print.", reason_technical: "Shape, color and 20W print match image 1." },
    actions: [{ action: "write_recalled", done: true, confidence: 0.95, evidence: "RECALLED across the front" }],
    handwritten_text: [{ text: "RECALLED", on_product: true, where: "across the front" }],
    identifiers: { model_text: null, lot_text: null, date_code_text: null, label_visible: false, where: null },
    photo_source: { kind: "camera_photo", signs: ["none"], confidence: 0.9, reason: "Camera noise and natural light." },
    retake_tip: "",
    person: { visible: false, kinds: [], where: "" },
    ...over,
  };
}

const visionOf = (r: VisionReport) => vi.fn(async (): Promise<VisionRun> => ({ report: r, model: "claude-opus-5-5", ms: 1, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));

const vote = (reviewer: "product" | "remedy", answer: ReviewInput["answer"], over: Partial<ReviewInput> = {}): ReviewInput => ({
  reviewer,
  answer,
  evidence:
    reviewer === "product"
      ? [{ check: "right_product", seen: "black case with 20W printed on the front", where: "center of the photo" }]
      : [{ check: "made_safe", seen: "RECALLED written in black marker", where: "across the front of the case" }],
  model_read: null,
  marker_text_read: reviewer === "remedy" ? "RECALLED" : null,
  reason_plain: "It matches.",
  reason_technical: "Details match.",
  confidence: 0.9,
  ...over,
});

const reviewersOf = (a: ReviewInput, b: ReviewInput, ctx = { recall: powerBank.recall, rule: powerBank.rule }) =>
  vi.fn(async (): Promise<ReviewRun> => ({ ...referee([a, b], ctx), reviews: [], ms: 1, model: "claude-opus-5-5" }));

const base = (over: Partial<VerifyInput> = {}): VerifyInput => ({ photo, mime: "image/jpeg", recall: powerBank.recall, proofRule: powerBank.rule, ...over });
const live = { aiAvailable: () => true };

describe("verified", () => {
  it("passes when every check passes and the refund is under the firm's cap", async () => {
    const vision = visionOf(report());
    const reviewers = vi.fn();
    const r = await verifyPhoto(base({ claimContext: { firmAmount: { value: "34.99", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } } }), { ...live, vision, reviewers });
    expect(r.decision).toBe("verified");
    expect(r.decided_by).toBe("checks");
    expect(Object.values(r.checks).every((c) => c.pass)).toBe(true);
    expect(r.amount).toMatchObject({ value: "34.99", source: "firm", cents: 3499 });
    expect(vision).toHaveBeenCalledTimes(1);
    expect(reviewers).not.toHaveBeenCalled();
    expect(r.summary.plain).toBe("Your photo checks out.");
  });

  it("refunds the lower of the firm's amount and the linked PayPal capture, after checking it was not refunded", async () => {
    const hasPriorRefund = vi.fn(async () => ({ refunded: false }));
    const r = await verifyPhoto(
      base({ claimContext: { firmAmount: { value: "34.99", currency: "USD" }, linkedCapture: { id: "CAP-1", amount: { value: "29.5", currency: "USD" } }, hasPriorRefund } }),
      { ...live, vision: visionOf(report()) },
    );
    expect(hasPriorRefund).toHaveBeenCalledWith("CAP-1");
    expect(r.checks.C6.pass).toBe(true);
    expect(r.amount).toMatchObject({ value: "29.50", source: "capture" });
    expect(r.decision).toBe("verified");
  });

  it("reads the marker word ignoring case and punctuation, but exactly", async () => {
    for (const text of ["recalled", "Recalled!", "RECALLED 11/5"]) {
      const r = await verifyPhoto(base(), { ...live, vision: visionOf(report({ handwritten_text: [{ text, on_product: true, where: "front" }] })) });
      expect(r.checks.C2.pass, text).toBe(true);
    }
  });
});

describe("retake", () => {
  it("asks for the marker word when the writing is misspelled", async () => {
    const r = await verifyPhoto(base(), { ...live, vision: visionOf(report({ handwritten_text: [{ text: "RECALL", on_product: true, where: "front" }] })) });
    expect(r.decision).toBe("retake");
    expect(r.decided_by).toBe("made_safe");
    expect(r.checks.C2.status).toBe("fail");
    expect(r.guidance?.plain).toBe("Please write RECALLED on the product first, then take a new photo.");
    expect(r.guidance?.steps[0]).toBe("Write the full word RECALLED on the product, in big letters.");
  });

  it("asks for the word on the product itself when it is written on paper beside it", async () => {
    const r = await verifyPhoto(base(), { ...live, vision: visionOf(report({ handwritten_text: [{ text: "RECALLED", on_product: false, where: "sticky note" }] })) });
    expect(r.decision).toBe("retake");
    expect(r.guidance?.steps[0]).toBe("Write RECALLED on the product itself, not on paper.");
  });

  it("asks for the cut when the cord is not cut, and names the product if it does not match", async () => {
    const r = await verifyPhoto(base({ recall: heater.recall, proofRule: heater.rule }), {
      ...live,
      vision: visionOf(report({ product: { ...report().product, match_score: 0.2 }, actions: [{ action: "cut_cord", done: false, confidence: 0.9, evidence: "Cord intact" }], handwritten_text: [] })),
    });
    expect(r.decision).toBe("retake");
    expect(r.guidance?.plain).toBe("Please cut the cord first, then take a new photo.");
    expect(r.guidance?.steps).toContain("Make sure the photo shows the recalled product: DREO Space Heaters, model DR-HSH015.");
  });

  it("treats a low-confidence cut as not shown", async () => {
    const r = await verifyPhoto(base({ recall: heater.recall, proofRule: heater.rule }), {
      ...live,
      vision: visionOf(report({ actions: [{ action: "cut_cord", done: true, confidence: 0.5, evidence: "Maybe cut near the plug" }], handwritten_text: [] })),
    });
    expect(r.checks.C2.status).toBe("fail");
    expect(r.decision).toBe("retake");
  });

  it("asks for the owner's own photo when it is a photo of a screen", async () => {
    const r = await verifyPhoto(base(), { ...live, vision: visionOf(report({ photo_source: { kind: "photo_of_screen", signs: ["moire", "screen_bezel"], confidence: 0.9, reason: "Moire and a bezel." } })) });
    expect(r.decision).toBe("retake");
    expect(r.decided_by).toBe("own_photo");
    expect(r.guidance?.plain).toBe("Please send a photo of your own product.");
  });

  it("asks for a JPG or PNG when the file cannot be read", async () => {
    const vision = vi.fn();
    const r = await verifyPhoto(base({ photo: Buffer.from("not an image at all, just text") }), { ...live, vision });
    expect(r.decision).toBe("retake");
    expect(r.decided_by).toBe("unreadable");
    expect(vision).not.toHaveBeenCalled();
  });
});

describe("firm review", () => {
  it("sends a refund over the auto-approve cap to a person, even when the reviewers agree", async () => {
    const reviewers = reviewersOf(vote("product", "meets"), vote("remedy", "meets"));
    const r = await verifyPhoto(base({ claimContext: { firmAmount: { value: "80.00", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" }, firmName: "Brightline Home" } }), { ...live, vision: visionOf(report()), reviewers });
    expect(r.decision).toBe("firm_review");
    expect(r.blockers.map((b) => b.id)).toEqual(["amount"]);
    expect(reviewers).toHaveBeenCalledTimes(1);
    expect(r.summary.plain).toBe("A person at Brightline Home will take a look. The refund is above the amount the firm approves on its own.");
  });

  it("verifies a borderline product match when both reviewers cite evidence and agree", async () => {
    const reviewers = reviewersOf(vote("product", "meets"), vote("remedy", "meets"));
    const r = await verifyPhoto(base(), { ...live, vision: visionOf(report({ product: { ...report().product, match_score: 0.72 } })), reviewers });
    expect(r.checks.C1.status).toBe("unclear");
    expect(r.decision).toBe("verified");
    expect(r.decided_by).toBe("reviewers");
    expect(r.review?.referee.decision).toBe("verify");
  });

  it("goes to a person when the reviewers disagree on the model (the look-alike preset)", async () => {
    const reviewers = reviewersOf(vote("product", "does_not_meet", { reason_plain: "A different power bank." }), vote("remedy", "meets"));
    const r = await verifyPhoto(base(), { ...live, vision: visionOf(report({ product: { ...report().product, match_score: 0.55 } })), reviewers });
    expect(r.decision).toBe("firm_review");
    expect(r.review?.referee).toMatchObject({ decision: "person", agreed: false });
  });

  it("does not let agreeing reviewers lift a clear product mismatch", async () => {
    const reviewers = reviewersOf(vote("product", "meets"), vote("remedy", "meets"));
    const r = await verifyPhoto(base(), { ...live, vision: visionOf(report({ product: { ...report().product, match_score: 0.3 } })), reviewers });
    expect(r.checks.C1.status).toBe("fail");
    expect(r.decision).toBe("firm_review");
  });

  it("catches a photo already sent with an earlier claim", async () => {
    const prior = [{ ref: "claim_0001", dhash: await dhash(photo) }];
    const r = await verifyPhoto(base({ priorHashes: prior }), { ...live, vision: visionOf(report()), reviewers: reviewersOf(vote("product", "meets"), vote("remedy", "meets")) });
    expect(r.checks.C3.status).toBe("fail");
    expect(r.checks.C3.reason_technical).toContain("claim_0001");
    expect(r.decision).toBe("firm_review");
  });

  it("goes to a person past the claim limit, and when the purchase was already refunded", async () => {
    const limit = await verifyPhoto(base({ claimContext: { payeeClaimCount: 1 } }), { ...live, vision: visionOf(report()), reviewers: vi.fn() });
    expect(limit.checks.C5.status).toBe("fail");
    expect(limit.decision).toBe("firm_review");
    const refunded = await verifyPhoto(
      base({ claimContext: { linkedCapture: { id: "CAP-2", amount: { value: "20.00", currency: "USD" } }, hasPriorRefund: async () => ({ refunded: true }) } }),
      { ...live, vision: visionOf(report()), reviewers: vi.fn() },
    );
    expect(refunded.checks.C6.status).toBe("fail");
    expect(refunded.decision).toBe("firm_review");
  });
});

describe("with no Claude key", () => {
  it("sends vision checks to a person and still runs the deterministic checks", async () => {
    const r = await verifyPhoto(base({ claimContext: { firmAmount: { value: "10.00", currency: "USD" } } }), { aiAvailable: () => false });
    expect(r.decision).toBe("firm_review");
    expect(r.checks.C1).toMatchObject({ status: "unavailable", reason_plain: VISION_UNAVAILABLE });
    expect(r.checks.C2).toMatchObject({ status: "unavailable", reason_plain: VISION_UNAVAILABLE });
    expect(r.checks.C3.reason_technical).toContain("Unique by hash");
    expect(r.checks.C5.pass).toBe(true);
    expect(r.checks.C6.pass).toBe(true);
    expect(r.review).toBeNull();
  });

  it("treats a vision error the same way", async () => {
    const vision = vi.fn(async () => {
      throw new Error("The AI service is busy just now.");
    });
    const r = await verifyPhoto(base(), { ...live, vision });
    expect(r.decision).toBe("firm_review");
    expect(r.checks.C1.status).toBe("unavailable");
  });
});

describe("fixtures that are decided before any model call", () => {
  const cases = loadFixtureCases().filter((c) => !c.needs_vision);
  it.each(cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const vision = vi.fn(async () => {
      throw new Error("vision must not be called");
    });
    const { recall, rule } = recalls[c.recall];
    const priorHashes = await Promise.all((c.prior_from ?? []).map(async (f, i) => ({ ref: `prior-${i}:${f}`, dhash: await dhash(fixtureFile(f)) })));
    const r = await verifyPhoto({ photo: fixtureFile(c.photo), recall, proofRule: rule, priorHashes, options: { officialHashCheck: c.official_hash_check } }, { ...live, vision });
    expect(vision).not.toHaveBeenCalled();
    expect(meetsExpectation(c.expect, r).misses).toEqual([]);
    expect(r.timings.vision_ms).toBe(0);
  });

  it("names the official image the owner sent, in plain words", async () => {
    const r = await verifyPhoto({ photo: fixtureFile("official/27054-dreo-1.png"), recall: heater.recall, proofRule: heater.rule }, live);
    expect(r.checks.C3.reason_plain).toBe("This is the official recall picture. Please send a photo of your own product.");
    expect(r.guidance?.steps.length).toBeGreaterThan(0);
  });

  it("gives friendly blur guidance", async () => {
    const r = await verifyPhoto({ photo: fixtureFile("derived/commons-coffee-in-a-mug.blur8.jpg"), recall: powerBank.recall, proofRule: powerBank.rule }, live);
    expect(r.guidance?.plain).toBe("The photo is a bit blurry. Please take it again.");
    expect(r.guidance?.steps).toContain("Hold the phone still and tap the screen on the product to focus.");
  });
});
