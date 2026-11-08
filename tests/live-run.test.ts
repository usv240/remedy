import { describe, expect, it, vi } from "vitest";
import { getPreset, LIVE_PRESET, liveGate, readRecorded, runPreset } from "@/app/api/try/_lib/presets";

/**
 * "Run it live" on Brightline's sample charger: one live run a day per visitor, within the site's daily AI budget,
 * and the recorded run, labelled with the reason, when the budget is spent, no key is set or the visitor used theirs.
 * The model is mocked here: no Claude call is made.
 */
const p = getPreset(LIVE_PRESET)!;
const rec = readRecorded(p.recorded)!;

describe("Run it live", () => {
  it("is offered only on Brightline's sample charger", () => {
    expect(p.id).toBe("sample-charger-cut");
    expect(rec.vision).toBeTruthy();
  });

  it("asks for a key, then the budget, then the visitor's one run a day", async () => {
    const yes = async () => true;
    expect(await liveGate(yes, { ai: () => false, budget: async () => ({ over: false }) })).toMatchObject({ ok: false, why: "no_key" });
    expect(await liveGate(yes, { ai: () => true, budget: async () => ({ over: true }) })).toMatchObject({ ok: false, why: "budget" });
    expect(await liveGate(async () => false, { ai: () => true, budget: async () => ({ over: false }) })).toMatchObject({ ok: false, why: "used" });
    expect(await liveGate(yes, { ai: () => true, budget: async () => ({ over: false }) })).toEqual({ ok: true });
  });

  it("calls the model when allowed, with the verification cache off, and says it ran live", async () => {
    const vision = vi.fn(async () => ({ ...rec.vision!, replayed: false }));
    const reviewers = vi.fn(async () => rec.reviews!);
    const run = await runPreset(p, { live: { ok: true }, deps: { vision, reviewers, cache: null, aiAvailable: () => true } });
    expect(vision).toHaveBeenCalledTimes(1);
    expect(run.live).toMatchObject({ ran: true, note: null });
    expect(run.replay.used).toBe(false);
    expect(run.result.decision).toBe("verified");
    expect(run.result.payment).toBeNull();
  });

  it("shows the recorded run, labelled, when the budget is spent", async () => {
    const run = await runPreset(p, { live: { ok: false, why: "budget", plain: "Today's AI budget is spent, so this is the recorded run." } });
    expect(run.live).toMatchObject({ ran: false, note: "Today's AI budget is spent, so this is the recorded run." });
    expect(run.replay.used).toBe(true);
    expect(run.result.decision).toBe(p.expected.decision);
  });

  it("never runs live for any other example", async () => {
    const other = getPreset("official-image")!;
    const run = await runPreset(other, { live: { ok: true } });
    expect(run.live).toBeNull();
    expect(run.live_ai).toBe(false);
  });
});
