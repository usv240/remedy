import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TERMS } from "@/app/api/claims/_lib/terms";
import { CLAIM_INFO } from "@/components/claim/info";

/**
 * "A photo taken now" as a recall setting (firm_recall.require_live_capture): off by default, the claim page's photo
 * button opens the camera and the library choice is hidden when it is on, and the claim records what was asked for.
 */
const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8");

describe("a photo taken now", () => {
  it("is a reviewed column, off by default, and off in the terms a server without a database uses", () => {
    expect(read("db", "schema.sql")).toContain("alter table firm_recall add column if not exists require_live_capture boolean not null default false;");
    expect(read("src", "lib", "db", "schema.ts")).toContain('requireLiveCapture: boolean("require_live_capture").notNull().default(false)');
    expect(DEFAULT_TERMS.requireLiveCapture).toBe(false);
  });

  it("opens the camera and hides the library choice and the sample photo when on", () => {
    const flow = read("src", "components", "claim", "ClaimFlow.tsx");
    const take = flow.slice(flow.indexOf("<input id={takeId}"), flow.indexOf("{file ? \"Take it again\""));
    expect(take).toContain('capture="environment"');
    expect(flow).toMatch(/\{!recall\.liveCapture && \(\s*<label className="btn btn-quiet cl-pick-btn"[\s\S]*?Choose a photo/);
    expect(flow).toContain("{recall.shop && !recall.liveCapture && (");
    expect(flow).toContain('fd.set("capture", recall.liveCapture ? "camera" : "any");');
  });

  it("is read from the firm's setting on the claim page, and the claim records what was asked", () => {
    expect(read("src", "app", "claim", "[recall]", "page.tsx")).toContain("requireLiveCapture === true");
    const claims = read("src", "app", "api", "claims", "_lib", "claims.ts");
    expect(claims).toContain('capture: { required: terms.requireLiveCapture, via: options.capture ?? "any" }');
    expect(read("src", "app", "api", "claims", "route.ts")).toContain('capture: form.get("capture") === "camera" ? "camera" : "any"');
  });

  it("says what it does and does not prove, on /evidence and in its Info", () => {
    const ev = read("src", "app", "evidence", "page.tsx");
    expect(ev).toContain('<Fold id="live-capture" title="A photo taken now"');
    expect(ev).toContain("What it does not prove.");
    expect(CLAIM_INFO["claim.live-capture"].technical).toMatch(/not proof/);
  });
});
