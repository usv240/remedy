import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRecall, publicRecall, ruleFor, verifyRecallFor } from "@/app/api/claims/_lib/recall";
import { isRecallNumber, isSampleNumber, parseRecallInput } from "@/app/api/claims/_lib/recall-text";
import { SHOP_RECALL } from "@/app/api/claims/_lib/terms";
import { normalizeNumber, recallByNumber, recallDetail, storedRule } from "@/lib/api/recall-data";
import { SAMPLE_RECALL } from "@/lib/firm/firm";
import { SHOP } from "@/lib/payments/shop-catalog";
import { loadAllRecalls, loadRecalls, localSearch, sampleHits } from "@/lib/recall/search";
import { verifyPhoto } from "@/lib/verify";
import { storedOfficialHashes } from "@/lib/verify/dhash";
import type { ReviewRun } from "@/lib/verify/reviewers";
import type { VisionRun } from "@/lib/verify/vision";

// Brightline Home's fictional sample recall BH-2026-01: always marked sample, kept out of every CPSC statistic, and the
// full automatic path (verified, then the refund) on public-domain photos of one charger.

const ROOT = process.cwd();
const N = "BH-2026-01";

describe("the sample recall is a sample, never a CPSC recall", () => {
  it("has a number no CPSC recall uses, and the claim and API code accept it", () => {
    expect(isSampleNumber(N)).toBe(true);
    expect(isRecallNumber(N)).toBe(true);
    expect(isRecallNumber("27056")).toBe(true);
    expect(isSampleNumber("27056")).toBe(false);
    expect(parseRecallInput("bh-2026-01")).toEqual({ number: N });
    expect(parseRecallInput("Recall 27056")).toEqual({ number: "27056" });
    expect(normalizeNumber("bh-2026-01")).toBe(N);
    expect(normalizeNumber("26-127")).toBe("26127");
  });

  it("is marked sample everywhere it is read", () => {
    const r = getRecall(N)!;
    expect(r.sample).toBe(true);
    expect(r.title).toBe("Brightline Home recalls 65W laptop chargers (sample recall)");
    expect(r.url).toBe("");
    expect(publicRecall(r).sample).toBe(true);
    expect(recallDetail(N)).toMatchObject({ sample: true, cpsc_url: "", sample_note: expect.stringContaining("fictional") });
    expect(recallByNumber("27056")?.sample).toBeUndefined();
  });

  it("is left out of the CPSC list behind every statistic, the explorer list and the benchmark", () => {
    expect(loadRecalls().some((r) => r.number === N)).toBe(false);
    expect(loadRecalls()).toHaveLength(1239);
    expect(loadRecalls().filter((r) => r.photoRefund)).toHaveLength(525);
    expect(JSON.stringify(JSON.parse(readFileSync(path.join(ROOT, "content", "recalls", "stats.json"), "utf8")))).not.toContain(N);
    expect(loadAllRecalls()[0].number).toBe(N);
    expect(localSearch("laptop charger").some((h) => h.number === N)).toBe(false);
    const labels = JSON.parse(readFileSync(path.join(ROOT, "content", "recalls", "benchmark", "labels.draft.json"), "utf8")) as { labels: Record<string, unknown> };
    expect(Object.keys(labels.labels)).not.toContain(N);
  });

  it("comes up in search only when every word matches, so it never tops a power bank search", () => {
    // Both sample firms recall the same sample charger: Brightline first, then Fernway, the second sample firm.
    expect(sampleHits("laptop charger").map((h) => h.number)).toEqual([N, "FW-2026-01"]);
    expect(sampleHits("brightline")[0]?.number).toBe(N);
    expect(sampleHits("fernway").map((h) => h.number)).toEqual(["FW-2026-01"]);
    expect(sampleHits("power bank recall")).toEqual([]);
    expect(sampleHits("charger", { filters: { photoRefund: false } })).toEqual([]);
  });

  it("uses the firm's hand-written rule, with the refund amount, and no model", () => {
    const { rule, source, model } = ruleFor(getRecall(N)!);
    expect(source).toBe("firm");
    expect(model).toBeNull();
    expect(rule).toMatchObject({ actions: ["cut_cord"], must_show: ["whole_product", "cut_or_damage"], remedy: "full_refund", refund_amount: 34.99, photo_required: true, contact_channel: "web_form" });
    expect(rule.steps).toEqual(["Unplug the charger.", "Cut the cord where it meets the charger case.", "Take one photo of the cut cord with the charger."]);
    expect(storedRule(N)?.source).toBe("firm");
  });

  it("stores its official image hashes with the one dHash, and the verifier reads its images from disk", () => {
    expect(storedOfficialHashes(N).map((h) => h.ref)).toEqual(["/samples/charger/intact.jpg", "/samples/charger/cord-exit.jpg", "/samples/charger/dc-plug.jpg"]);
    const images = verifyRecallFor(getRecall(N)!).images;
    expect(images.every((i) => i.data && i.data.length > 1000)).toBe(true);
  });

  it("is the shop's recall and the firm's main recall", () => {
    expect(SHOP_RECALL).toBe(N);
    expect(SAMPLE_RECALL).toBe(N);
    expect(SHOP.recall).toBe(N);
    expect(SHOP.product).toMatchObject({ name: "Brightline 65W laptop charger (sample)", priceCents: 3499, image: "/samples/charger/intact.jpg" });
  });
});

describe("the full automatic path on the recorded run", () => {
  const rec = JSON.parse(readFileSync(path.join(ROOT, "content", "presets", "recorded", "sample-charger-cut.json"), "utf8")) as { vision: VisionRun; reviews: ReviewRun };
  const run = (photo: string, ctx: Record<string, unknown> = {}) =>
    verifyPhoto(
      { photo: readFileSync(path.join(ROOT, photo)), recall: verifyRecallFor(getRecall(N)!), proofRule: ruleFor(getRecall(N)!).rule, claimContext: { firmAmount: { value: "34.99", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" }, ...ctx }, options: { cache: false } },
      { aiAvailable: () => false, cache: null, vision: async () => rec.vision, reviewers: async () => rec.reviews },
    );

  it("verifies the photo of the charger with its cord cut, and the refund is $34.99, inside the auto cap", async () => {
    const r = await run("content/verify/fixtures/sample/cord-cut.jpg");
    expect(r.decision).toBe("verified");
    expect(r.checks.C2.status).toBe("pass");
    expect(r.checks.C3.status).toBe("pass");
    expect(r.amount).toMatchObject({ value: "34.99" });
    expect(r.blockers.every((b) => b.soft)).toBe(true);
  });

  it("refunds the lower of $34.99 and the linked purchase, and a refund over the cap goes to a person", async () => {
    const linked = await run("content/verify/fixtures/sample/cord-cut.jpg", { linkedCapture: { id: "CAP-1", amount: { value: "34.99", currency: "USD" } }, hasPriorRefund: async () => ({ refunded: false }) });
    expect(linked.amount).toMatchObject({ value: "34.99", source: "firm" });
    const overCap = await run("content/verify/fixtures/sample/cord-cut.jpg", { autoCap: { value: "30.00", currency: "USD" } });
    expect(overCap.decision).toBe("firm_review");
  });

  it("asks for the owner's own photo when the official picture is sent", async () => {
    const r = await run("public/samples/charger/intact.jpg");
    expect(r.decision).toBe("retake");
    expect(r.decided_by).toBe("own_photo");
  });
});
