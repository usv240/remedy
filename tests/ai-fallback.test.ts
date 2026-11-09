import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** The log lines the fresh module wrote, read back here instead of printed: the pause is logged as an error by design. */
let logged: { level: string; msg: string; status?: number }[] = [];

// A fresh copy of the module for each test, so one test's pause never carries into the next. Its logger is fresh too,
// and its lines go to `logged`, so a clean run prints no error line while each test can still read what was logged.
async function load() {
  vi.resetModules();
  const { setLogSink } = await import("@/lib/log");
  logged = [];
  setLogSink((level, line) => logged.push({ level, ...(JSON.parse(line) as { msg: string; status?: number }) }));
  return import("@/lib/ai/claude");
}

describe("Claude errors fall back the way a missing key does", () => {
  const key = process.env.ANTHROPIC_API_KEY;
  // The first import of the AI module and the SDK is the slow part under a full-suite load (vitest reports most of a
  // run as import time). Pay it once here, with room to spare, so no test below waits on a cold import.
  beforeAll(async () => {
    await import("@/lib/ai/claude");
  }, 120_000);
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = key;
    vi.useRealTimers();
  });

  it("a billing refusal pauses every AI feature for three minutes, then they come back", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    // Load the module on real timers, then fake only the clock: the pause is measured by Date.now, so the three
    // minutes pass in no time and nothing else waits on a held timer.
    const ai = await load();
    vi.useFakeTimers({ toFake: ["Date"] });
    expect(ai.aiAvailable()).toBe(true);
    // The SDK builds the message from the response body, as the API sent it.
    const body = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } };
    const err = ai.aiError(new Anthropic.BadRequestError(400, body, undefined, new Headers()));
    expect(err).toBeInstanceOf(ai.AiUnavailableError);
    expect(ai.aiAvailable()).toBe(false);
    expect(ai.aiPaused()).toBe(true);
    // The pause is logged once, as an error with the API's status, so the operator sees it on /ops.
    expect(logged.filter((l) => l.level === "error")).toEqual([{ level: "error", msg: "Claude API turned the account away; AI features use their fallbacks for three minutes", status: 400, ts: expect.any(String) }]);
    vi.setSystemTime(Date.now() + 3 * 60_000 + 1);
    expect(ai.aiAvailable()).toBe(true);
  }, 120_000);

  it("a revoked key pauses too", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const ai = await load();
    ai.aiError(new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers()));
    expect(ai.aiAvailable()).toBe(false);
    expect(logged.some((l) => l.level === "error" && l.status === 401 && /turned the account away/.test(l.msg))).toBe(true);
  });

  it("a busy or unreachable API falls back for that request only", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const ai = await load();
    expect(ai.aiError(new Anthropic.InternalServerError(529, { type: "error" }, "Overloaded", new Headers()))).toBeInstanceOf(ai.AiUnavailableError);
    expect(ai.aiError(new Anthropic.APIConnectionError({ message: "socket hang up" }))).toBeInstanceOf(ai.AiUnavailableError);
    expect(ai.aiAvailable()).toBe(true);
    // A busy API is not a pause: nothing is logged as an error.
    expect(logged.filter((l) => l.level === "error")).toEqual([]);
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
