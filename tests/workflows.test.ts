import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sandbox money suites run in CI on demand: .github/workflows/sandbox-e2e.yml runs tests/e2e/claim.mjs and
 * tests/e2e/try-payout.mjs when the repository holds the sandbox secrets named at its top, and stops with a plain
 * message when it does not.
 */
const ROOT = process.cwd();
const file = path.join(ROOT, ".github", "workflows", "sandbox-e2e.yml");
const SECRETS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "SANDBOX_BUYER_EMAIL"];

describe("the sandbox money workflow", () => {
  const text = existsSync(file) ? readFileSync(file, "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)) : "";

  it("runs only when started by hand", () => {
    expect(text).toMatch(/^on:\n {2}workflow_dispatch:\n\n/m);
    expect(text).not.toMatch(/^\s+(push|pull_request|schedule):/m);
  });

  it("names every secret it reads at the top of the file, and reads no other", () => {
    const head = text.split("\nname:")[0];
    for (const s of SECRETS) expect(head, s).toMatch(new RegExp(`#\\s+${s}\\s`));
    const used = [...new Set([...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort();
    expect(used).toEqual([...SECRETS].sort());
  });

  it("stops with a plain message when a secret is missing, before anything is built or sent", () => {
    expect(text).toContain("These repository secrets are not set:");
    expect(text).toContain("Nothing was sent.");
    expect(text).toMatch(/needs: secrets\n\s+if: needs\.secrets\.outputs\.ready == 'true'/);
  });

  it("runs the two suites against a seeded database and keeps the transcript", () => {
    for (const step of ["node scripts/migrate.mjs", "npx tsx scripts/seed-firm.ts", "precompute.ts --run --yes --recorded-only", "node tests/e2e/claim.mjs", "node tests/e2e/try-payout.mjs"]) expect(text, step).toContain(step);
    expect(text.indexOf("tests/e2e/claim.mjs\n")).toBeLessThan(text.indexOf("tests/e2e/try-payout.mjs\n"));
    expect(text).toContain("content/public/e2e-transcript.json");
    // No Claude key in this run: the model answers are the recorded ones.
    expect(text).toMatch(/ANTHROPIC_API_KEY: ""/);
  });
});
