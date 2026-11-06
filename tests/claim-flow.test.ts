import { describe, expect, it } from "vitest";
import { exampleFor, isRecallNumber, parseRecallInput, plainHazard, productName, recallSlug, replacementQuery } from "@/app/api/claims/_lib/recall-text";
import { isTestRequest } from "@/app/api/claims/_lib/http";
import { reviewWindow as serverReviewWindow } from "@/app/api/claims/_lib/terms";
import { CHECK_ORDER, checkWord, day, money, payeeWords, reviewWindow, seconds } from "@/components/claim/format";
import { CLAIM_INFO } from "@/components/claim/info";
import { headline } from "@/components/claim/ReceiptLive";
import { markerWord, ownerSteps, stepKind } from "@/components/claim/steps";
import type { ClaimView, PaymentView } from "@/app/api/claims/_lib/types";
import picks from "../content/recalls/demo-picks.json";

const rules = Object.fromEntries((picks as { picks: { number: string; proofRule: { steps: string[]; actions: string[]; marker_text: string | null } }[] }).picks.map((p) => [p.number, p.proofRule]));

describe("the owner's checklist", () => {
  it("names each kind of step from its words", () => {
    expect(stepKind("Write recalled on the power bank in permanent marker.")).toBe("write");
    expect(stepKind("Take a photo of the power bank showing the writing.")).toBe("photo");
    expect(stepKind("Email the photo to Mitrytech at HAIARArecall@outlook.com.")).toBe("send");
    expect(stepKind("Upload a photo on the firm's recall page.")).toBe("send");
    expect(stepKind("Cut the power cord.")).toBe("cut_cord");
    expect(stepKind("Take a photo that shows the cut cord.")).toBe("photo");
    expect(stepKind("Cut the pajamas in half.")).toBe("cut_in_half");
    expect(stepKind("Unplug the hair dryer brush and stop using it.")).toBe("stop");
    expect(stepKind("Dispose of the power bank following local laws.")).toBe("dispose");
    expect(stepKind("Cut off the helmet straps.")).toBe("other");
  });

  it("turns each demo recall's rule into at most four steps, sending the photo here instead of by email", () => {
    for (const [n, rule] of Object.entries(rules)) {
      const steps = ownerSteps(rule);
      expect(steps.length, n).toBeGreaterThan(1);
      expect(steps.length, n).toBeLessThanOrEqual(4);
      expect(steps.filter((s) => s.kind === "send"), n).toHaveLength(1);
      expect(steps.map((s) => s.text).join(" "), n).not.toMatch(/@|e-?mail/i);
      expect(new Set(steps.map((s) => s.text)).size, n).toBe(steps.length);
    }
    expect(ownerSteps(rules["27056"]).map((s) => s.kind)).toEqual(["write", "photo", "send", "dispose"]);
    expect(ownerSteps(rules["26754"]).map((s) => s.kind)).toEqual(["stop", "cut_cord", "photo", "send"]);
  });

  it("writes steps from the actions when a rule has none, and keeps the send step when trimming", () => {
    expect(ownerSteps({ steps: [], actions: ["write_recalled"], marker_text: "recalled" }).map((s) => s.text)).toEqual([
      "Write RECALLED on it in permanent marker.",
      "Take one photo that shows the whole product.",
      "Send the photo here. Remedy checks it for you.",
    ]);
    const long = ownerSteps({ steps: ["Stop using it.", "Cut the cord.", "Cut it in half.", "Take a photo of it.", "Email the photo to a@b.co.", "Throw it away."], actions: ["cut_cord"] });
    expect(long).toHaveLength(4);
    expect(long.at(-1)?.kind).toBe("send");
  });

  it("asks for the marker word in capitals only when the rule asks for writing", () => {
    expect(markerWord(rules["27056"])).toBe("RECALLED");
    expect(markerWord(rules["26754"])).toBeNull();
  });
});

describe("recall text helpers", () => {
  it("reads a recall number or a cpsc.gov address from what an owner pastes", () => {
    expect(parseRecallInput("27056")).toEqual({ number: "27056" });
    expect(parseRecallInput("Recall #27045")).toEqual({ number: "27045" });
    expect(parseRecallInput("https://www.cpsc.gov/Recalls/2027/HAIARA-Power-Banks-Recalled-Due-to-Risk/")).toEqual({ url: "haiara-power-banks-recalled-due-to-risk" });
    expect(parseRecallInput("power bank")).toBeNull();
    expect(parseRecallInput("   ")).toBeNull();
    expect(recallSlug("https://cpsc.gov/Recalls/2027/HAIARA-Power-Banks?x=1")).toBe("haiara-power-banks");
    expect(isRecallNumber("27056")).toBe(true);
    expect(isRecallNumber("27056; drop table")).toBe(false);
  });

  it("puts the hazard in one plain sentence", () => {
    expect(plainHazard("The power bank's lithium battery can explode and ignite, posing fire and burn hazards to consumers.", "x")).toBe("The power bank's lithium battery can explode and ignite, posing fire and burn hazards to consumers.");
    const long = "The recalled hair dryer brushes are in violation of federal regulations for hair dryers as they lack an integrated immersion protection device, which presents a substantial product hazard to consumers and the risk of death. In addition, they can overheat.";
    expect(plainHazard(long, "Guang Zhou Recalls Wantefully Hair Dryer Brushes Due to Risk of Serious Injury or Death from Electrocution, Shock and Burn Hazards; Violate Federal Regulations")).toBe(
      "Risk of serious injury or death from electrocution, shock and burn hazards.",
    );
  });

  it("names the product and builds a brand-free replacement search", () => {
    expect(productName({ products: [{ name: "HAIARA power banks" }], title: "t" })).toBe("HAIARA power banks");
    expect(productName({ products: [], title: "Acme Kettles Recalled Due to Burn Hazard" })).toBe("Acme Kettles");
    expect(replacementQuery({ products: [{ name: "HAIARA power banks" }], title: "" })).toBe("power banks");
    expect(replacementQuery({ products: [{ name: "Wantefully Hair Dryer Brushes" }], title: "" })).toBe("Hair Dryer Brushes");
  });

  it("shows the CPSC's own made-safe photo only for the kind of action it shows", () => {
    expect(exampleFor({ actions: ["cut_cord"], steps: [] })?.recall).toBe("26125");
    expect(exampleFor({ actions: ["other"], steps: ["Cut off the helmet straps."] })?.recall).toBe("25007");
    expect(exampleFor({ actions: ["write_recalled"], steps: [] })).toBeNull();
    expect(exampleFor({ actions: ["other"], steps: ["Break it."] })).toBeNull();
  });
});

describe("formatting for owners", () => {
  it("prints a recall's calendar date as written, whatever the time zone", () => {
    expect(day("2026-10-29")).toBe("Oct 29, 2026");
    expect(day(null)).toBe("");
  });
  it("words the firm's review time and the money", () => {
    expect(reviewWindow(48)).toBe("usually within 2 days");
    expect(reviewWindow(4)).toBe("usually within 4 hours");
    expect(serverReviewWindow(48)).toBe(reviewWindow(48));
    expect(money("20")).toBe("$20.00");
    expect(money(null)).toBe("");
    expect(seconds(4249)).toBe("4.2 s");
    expect(payeeWords({ type: "venmo", masked: "•••-•••-0134" })).toBe("Venmo (•••-•••-0134)");
  });
  it("lists the six checks in order, each status in a kind word", () => {
    expect(CHECK_ORDER.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
    expect(checkWord("pass").tone).toBe("positive");
    expect(checkWord("fail").word).toBe("Needs a change");
    expect(checkWord("skipped").word).toBe("Not checked");
  });
});

describe("the receipt headline", () => {
  const base: ClaimView = {
    id: "00000000-0000-4000-8000-000000000000",
    recall: { number: "27056", title: "t", product: "HAIARA power banks" },
    status: "approved",
    decision: "verified",
    decided_by: "checks",
    channel: "web",
    created_at: "2026-11-05T20:00:00.000Z",
    decided_at: null,
    checks: [],
    guidance: null,
    summary: null,
    amount: { value: "20.00", currency: "USD", source: "demo" },
    quality: null,
    timings: null,
    model: null,
    review: null,
    link: null,
    payment: null,
    firm: { name: "Brightline Home", sample: true, review_hours: 48, refund_source: "demo" },
    photo_url: null,
    receipt_url: "/r/x",
    sandbox_label: "Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm.",
  };
  const pay = (p: Partial<PaymentView>): PaymentView => ({
    route: "payout",
    plan_status: "submitted",
    amount: "20.00",
    currency: "USD",
    reasons: { plain: "", technical: "" },
    approval: null,
    status: "sending",
    status_label: null,
    status_plain: null,
    final: false,
    paypal_status: null,
    payee: { type: "email", masked: "j•••@example.com" },
    ids: { payout_batch_id: null, payout_item_id: null, transaction_id: null, refund_id: null, order_id: null, capture_id: null, debug_id: null },
    issue: null,
    replacement: null,
    updated_at: null,
    ...p,
  });
  it("says where the money is, in the owner's words", () => {
    expect(headline({ ...base, payment: pay({ status: "paid", final: true }) }).title).toBe("Paid $20.00 to your PayPal.");
    expect(headline({ ...base, payment: pay({ status: "paid", final: true }) }).pill.tone).toBe("paid");
    expect(headline({ ...base, payment: pay({ route: "refund", status: "paid", final: true, amount: "34.99" }) }).title).toBe("Refunded $34.99 to your PayPal payment.");
    expect(headline({ ...base, payment: pay({}) }).title).toBe("Your $20.00 refund is on its way.");
    expect(headline({ ...base, payment: pay({ status: "unclaimed" }) }).title).toBe("Your $20.00 refund is waiting for you.");
    expect(headline({ ...base, decision: "firm_review", payment: pay({ plan_status: "awaiting_approval", status: null }) }).title).toBe("Waiting for Brightline Home.");
    expect(headline({ ...base, decision: "retake", payment: null }).pill.word).toBe("Retake");
  });
});

describe("the end-to-end test switch", () => {
  it("is off without CHECKS_SECRET, and needs the exact secret", () => {
    const req = (h?: string) => new Request("http://x/api/claims", { headers: h ? { "x-checks-secret": h } : {} });
    const prev = process.env.CHECKS_SECRET;
    delete process.env.CHECKS_SECRET;
    expect(isTestRequest(req("anything"))).toBe(false);
    process.env.CHECKS_SECRET = "s3cret-for-tests";
    expect(isTestRequest(req())).toBe(false);
    expect(isTestRequest(req("s3cret-for-test"))).toBe(false);
    expect(isTestRequest(req("s3cret-for-tests"))).toBe(true);
    if (prev === undefined) delete process.env.CHECKS_SECRET;
    else process.env.CHECKS_SECRET = prev;
  });
});

describe("Info entries for the owner's path", () => {
  it("say what and why, in plain and kind words", () => {
    for (const [id, e] of Object.entries(CLAIM_INFO)) {
      expect(e.title, id).toBeTruthy();
      expect(e.what, id).toBeTruthy();
      expect(e.why, id).toBeTruthy();
      const text = JSON.stringify(e);
      expect(text, `${id}: no em dashes`).not.toMatch(/—/);
      expect(text, `${id}: no emoji`).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text, `${id}: kind words only`).not.toMatch(/\b(fraud|fake|scam)/i);
    }
  });
});
