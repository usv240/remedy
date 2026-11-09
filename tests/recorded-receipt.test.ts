import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RECORDED_RECEIPT_URL, recordedReceipt } from "@/lib/recorded-receipt";

/**
 * A receipt anyone can open without sending a payout: the one-click payout's last recorded run, read from the
 * transcript in the repo, at one fixed address on every deployment. Linked beside "Send $34.99" on /try and from
 * /evidence; the transcript points at it instead of a receipt that lives in one run's database.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

describe("the recorded receipt", () => {
  it("carries PayPal's real batch and item ids and status from the transcript, labelled recorded", () => {
    const t = JSON.parse(read("content", "public", "e2e-transcript.json")) as { suites: Record<string, { ids: Record<string, unknown> }> };
    const ids = t.suites["try-payout"].ids;
    const r = recordedReceipt();
    expect(r).not.toBeNull();
    expect([r!.batchId, r!.itemId, r!.status, r!.amount]).toEqual([ids.payout_batch_id, ids.payout_item_id, ids.payout_status, ids.amount]);
    expect(r!.status).toBe("SUCCESS");
    const page = read("src", "app", "r", "recorded", "page.tsx");
    expect(page).toContain("recordedReceipt()");
    expect(page).toMatch(/>\s*Recorded\s*</);
  });

  it("opens at a fixed address with no database, so no deployment or reseed loses it", () => {
    expect(RECORDED_RECEIPT_URL).toBe("/r/recorded");
    const page = read("src", "app", "r", "recorded", "page.tsx");
    expect(page).not.toMatch(/from "@\/lib\/db"|await |dbConfigured|getClaimView/);
    expect(read("src", "lib", "recorded-receipt.ts")).not.toMatch(/readFile|from "@\/lib\/db"/);
  });

  it("is linked beside the send button and from /evidence, and the transcript points at it", () => {
    const pay = read("src", "components", "try", "SandboxPay.tsx");
    expect(pay).toContain(`href="${RECORDED_RECEIPT_URL}"`);
    expect(pay.indexOf("Send ${amount} to the sandbox buyer")).toBeLessThan(pay.indexOf(`href="${RECORDED_RECEIPT_URL}"`));
    expect(read("src", "app", "evidence", "page.tsx")).toContain("RECORDED_RECEIPT_URL");
    const transcript = read("content", "public", "e2e-transcript.json");
    expect(transcript).not.toMatch(/"detail": "\/r\/[0-9a-f-]{36}"/);
    expect(transcript).toContain(RECORDED_RECEIPT_URL);
    expect(read("tests", "e2e", "try-payout.mjs")).toContain("the recorded copy is /r/recorded");
  });
});
