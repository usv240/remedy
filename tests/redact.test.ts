import { describe, expect, it, vi } from "vitest";
import { apiKeyState, publicAiError } from "@/lib/ai/claude";
import { redactDeep, redactSecrets } from "@/lib/mask";
import { verifyPhoto, type VerifyInput } from "@/lib/verify";
import { fixtureFile, loadFixtureRecalls } from "@/lib/verify/fixtures";

// A made-up key with the real prefix, and the exact shape of the error a two-line key value produces.
const FAKE_KEY = "sk-ant-api03-" + "x".repeat(40);
const FAKE_ID = "AV" + "y".repeat(40);
const LEAK = `Headers.append: "Bearer ${FAKE_KEY}\nPAYPAL_CLIENT_ID=${FAKE_ID}" is an invalid header value.`;

describe("credentials never reach a visitor", () => {
  it("redacts keys, bearer and basic credentials, PayPal tokens and NAME=value lines", () => {
    const out = redactSecrets(LEAK);
    expect(out).not.toContain("sk-ant");
    expect(out).not.toContain(FAKE_ID);
    expect(redactSecrets(`ApiKey ${"z".repeat(30)}`)).toBe("ApiKey [redacted]");
    expect(redactSecrets(`token A21AA${"q".repeat(40)}`)).toBe("token [redacted token]");
  });

  it("leaves plain words, amounts and ids alone", () => {
    const plain = "The cord is cut. Refund $34.99 for recall BH-2026-01, payout 5UXD2E8A7EBQJ, check C2 passed.";
    expect(redactSecrets(plain)).toBe(plain);
  });

  it("walks nested results", () => {
    const r = redactDeep({ checks: { C1: { reason_technical: `Vision unavailable: ${LEAK}`, score: 0.5 } }, list: [LEAK] });
    expect(JSON.stringify(r)).not.toContain("sk-ant");
    expect(r.checks.C1.score).toBe(0.5);
  });

  it("treats a key with a second line as malformed, so it is never sent", () => {
    expect(apiKeyState({ ANTHROPIC_API_KEY: `${FAKE_KEY}\nPAYPAL_CLIENT_ID=${FAKE_ID}` })).toBe("malformed");
    expect(apiKeyState({ ANTHROPIC_API_KEY: ` ${FAKE_KEY} ` })).toBe("ok");
    expect(apiKeyState({})).toBe("missing");
  });

  it("tells a visitor the kind of failure, never the raw error text", () => {
    const msg = publicAiError(new TypeError(LEAK), "photo check");
    expect(msg).toBe("The photo check could not run just now.");
  });

  it("a model call that throws a key in its error leaves no trace of it in the verify result", async () => {
    const r = loadFixtureRecalls()["27056"];
    const input: VerifyInput = { photo: fixtureFile("other/commons-coffee-in-a-mug.jpg"), mime: "image/jpeg", recall: r.recall, proofRule: r.rule };
    const vision = vi.fn(async () => {
      throw new TypeError(LEAK);
    });
    const result = await verifyPhoto(input, { aiAvailable: () => true, vision, reviewers: vi.fn() });
    expect(vision).toHaveBeenCalled();
    const json = JSON.stringify(result);
    expect(json).not.toContain("sk-ant");
    expect(json).not.toContain(FAKE_ID);
    expect(json).toContain("could not run just now");
  });
});
