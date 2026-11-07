import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { refundPhrase } from "@/app/api/claims/_lib/recall-text";

describe("the refund named in the claim page's first line", () => {
  it("names a full refund, or the amount, as the remedy states it", () => {
    expect(refundPhrase("full refund")).toBe("a full refund");
    expect(refundPhrase("a full refund")).toBe("a full refund");
    expect(refundPhrase("a full refund of the purchase price")).toBe("a full refund of the purchase price");
    expect(refundPhrase("a full refund of $34.99")).toBe("a full refund of $34.99");
    expect(refundPhrase("a full cash refund of $49.99")).toBe("a full refund of $49.99");
    expect(refundPhrase("a $40 refund")).toBe("a $40 refund");
    expect(refundPhrase("a refund of $42")).toBe("a refund of $42");
  });

  it("names nothing when the remedy offers a choice, credit or conditions", () => {
    for (const t of [
      "a refund in the form of a $15 online store credit",
      "a full refund with proof of purchase, or a $36 cash refund without proof of purchase",
      "a full refund, including cost of shipping",
      "a refund",
      "",
      null,
      undefined,
    ]) {
      expect(refundPhrase(t), String(t)).toBeNull();
    }
  });

  it("names a refund for most real photo-refund recalls", () => {
    const pr = JSON.parse(readFileSync("content/recalls/proof-rules.json", "utf8")) as { rules: Record<string, { refund_amount_text?: string | null }> };
    const rules = Object.values(pr.rules);
    const named = rules.filter((r) => refundPhrase(r.refund_amount_text)).length;
    expect(named / rules.length).toBeGreaterThan(0.75);
  });
});
