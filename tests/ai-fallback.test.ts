import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

// A fresh copy of the module for each test, so one test's pause never carries into the next.
async function load() {
  vi.resetModules();
  return import("@/lib/ai/claude");
}

describe("Claude errors fall back the way a missing key does", () => {
  const key = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = key;
    vi.useRealTimers();
  });

  it("a billing refusal pauses every AI feature for three minutes, then they come back", async () => {
    vi.useFakeTimers();
    process.env.ANTHROPIC_API_KEY = "test-key";
    const ai = await load();
    expect(ai.aiAvailable()).toBe(true);
    // The SDK builds the message from the response body, as the API sent it.
    const body = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } };
    const err = ai.aiError(new Anthropic.BadRequestError(400, body, undefined, new Headers()));
    expect(err).toBeInstanceOf(ai.AiUnavailableError);
    expect(ai.aiAvailable()).toBe(false);
    expect(ai.aiPaused()).toBe(true);
    vi.advanceTimersByTime(3 * 60_000 + 1);
    expect(ai.aiAvailable()).toBe(true);
  });

  it("a revoked key pauses too", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const ai = await load();
    ai.aiError(new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers()));
    expect(ai.aiAvailable()).toBe(false);
  });

  it("a busy or unreachable API falls back for that request only", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const ai = await load();
    expect(ai.aiError(new Anthropic.InternalServerError(529, { type: "error" }, "Overloaded", new Headers()))).toBeInstanceOf(ai.AiUnavailableError);
    expect(ai.aiError(new Anthropic.APIConnectionError({ message: "socket hang up" }))).toBeInstanceOf(ai.AiUnavailableError);
    expect(ai.aiAvailable()).toBe(true);
  });

  it("any other error is passed on unchanged, so a real bug still shows", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const ai = await load();
    const schema = new Anthropic.BadRequestError(400, { type: "error" }, "output_config.format: invalid schema", new Headers());
    expect(ai.aiError(schema)).toBe(schema);
    const plain = new TypeError("x is undefined");
    expect(ai.aiError(plain)).toBe(plain);
    expect(ai.aiAvailable()).toBe(true);
  });
});
