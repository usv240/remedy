import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRecall } from "@/app/api/claims/_lib/recall";
import { getPreset, listPresets, readRecorded, runPreset } from "@/app/api/try/_lib/presets";

/**
 * Every ready-made example on /try gives the answer it promises. Runs offline and free: checks that need no model
 * run live, and checks that need Claude replay the one recorded answer in content/presets/recorded/.
 */
const { presets } = listPresets();

describe("ready-made examples", () => {
  it("each names a real recall, a photo on disk, and a recording when it needs Claude", () => {
    expect(presets.length).toBeGreaterThanOrEqual(4);
    for (const p of presets) {
      expect(getRecall(p.recall), p.id).not.toBeNull();
      expect(existsSync(path.join(process.cwd(), "content", "verify", "fixtures", p.photo)), p.id).toBe(true);
      if (p.recorded) expect(readRecorded(p.recorded)?.vision, p.id).toBeTruthy();
      if (p.technical) expect(readRecorded(p.technical.recorded)?.vision, `${p.id} technical`).toBeTruthy();
      expect(JSON.stringify(p)).not.toMatch(/—|\b(fraud|fake|scam)/i);
    }
  });

  it.each(presets.map((p) => [p.id]))("%s gives the answer it promises", async (id) => {
    const p = getPreset(id)!;
    const run = await runPreset(p);
    const r = run.result;
    if (p.expected.decision) expect(r.decision).toBe(p.expected.decision);
    if (p.expected.decided_by) expect(r.decided_by).toBe(p.expected.decided_by);
    for (const [cid, status] of Object.entries(p.expected.checks ?? {})) expect(r.checks.find((c) => c.id === cid)?.status, cid).toBe(status);
    // A preset never pays and never claims to.
    expect(r.payment).toBeNull();
    expect(r.decision === "verified" && !p.expected.decision).toBe(false);
    expect(run.replay.used).toBe(Boolean(p.recorded));
  }, 60_000);

  it("the CPSC example, with the official-image match off, sees the right product and is never paid", async () => {
    // How sure the model is of the cut on this exact picture varies between runs (content/verify/fixtures/cases.json,
    // made-safe-hair-dryer-cord-cut), so only what holds in every recorded run is checked: the right product, a photo
    // the model does not take for the owner's own, and no payment.
    const p = getPreset("cpsc-example")!;
    const run = await runPreset(p, { technical: true });
    expect(run.result.checks.find((c) => c.id === "C1")?.status).toBe("pass");
    expect(run.result.checks.find((c) => c.id === "C3")?.status).not.toBe("pass");
    expect(run.result.decision).not.toBe("verified");
    expect(run.replay.used).toBe(true);
  }, 60_000);
});
