import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSampleNumber, recallCredit, sampleFirmOf } from "@/lib/recall/label";
import { getRecall, ruleFor } from "@/app/api/claims/_lib/recall";
import { photoHashes } from "@/lib/verify";
import { FIXTURES_DIR } from "@/lib/verify/fixtures";
import { NETWORK, sendToSecondFirm } from "../scripts/public/record-network-run";

/**
 * The shared hash pool across two firms (content/public/network-run.json, written by
 * scripts/public/record-network-run.ts): a photo already claimed at Brightline Home is held for a person at Fernway
 * Home, before any model call, and only the hash and a row id cross. Runs again here with no model and no database.
 */
type NetworkRun = {
  first: { firm: string; recall: string; claim: { decision: string }; pool_row: { source: string; ref: string; recall_number: string; dhash: string } };
  crossed: { fields: string[]; dhash: string };
  second: { firm: string; recall: string; decision: string; decided_by: string; reached_model: boolean; c3: { status: string; plain: string } };
  control: { reached_model: boolean };
  model_calls: number;
};
const run = JSON.parse(readFileSync(path.join(process.cwd(), "content", "public", "network-run.json"), "utf8")) as NetworkRun;

describe("a second sample firm, Fernway Home", () => {
  it("has its own sample recall, labelled as a sample, with its own hand-written rule", () => {
    expect(isSampleNumber(NETWORK.second)).toBe(true);
    expect(sampleFirmOf(NETWORK.second)).toBe("Fernway Home");
    expect(sampleFirmOf(NETWORK.first)).toBe("Brightline Home");
    expect(sampleFirmOf("27056")).toBeNull();
    expect(recallCredit(NETWORK.second)).toContain("Fernway Home and its recall are fictional");
    const r = getRecall(NETWORK.second)!;
    expect(r.sample).toBe(true);
    expect(r.title).toMatch(/\(sample recall\)$/);
    expect(r.manufacturers).toEqual(["Fernway Home (sample firm)"]);
    expect(ruleFor(r)).toMatchObject({ source: "firm", rule: { actions: ["cut_cord"], refund_amount: 29.99 } });
  });
});

describe("one photo, two firms (content/public/network-run.json)", () => {
  it("records Brightline's paid claim, Fernway's hold before any model call, and only ref and dhash crossing", async () => {
    const { dhash } = await photoHashes(readFileSync(path.join(FIXTURES_DIR, NETWORK.photo)));
    expect(run.first).toMatchObject({ firm: "Brightline Home", recall: NETWORK.first, claim: { decision: "verified" }, pool_row: { source: "claim", recall_number: NETWORK.first, dhash } });
    expect(run.crossed).toEqual({ ...run.crossed, fields: ["ref", "dhash"], dhash });
    expect(run.second).toMatchObject({ firm: "Fernway Home", recall: NETWORK.second, decision: "firm_review", decided_by: "checks", reached_model: false, c3: { status: "fail" } });
    expect(run.second.c3.plain).toMatch(/claim on another recall/);
    expect(run.control.reached_model).toBe(true);
    expect(run.model_calls).toBe(0);
  });

  it("gives the same answer when run again, and without Brightline's hash the photo goes on to the model step", async () => {
    const held = await sendToSecondFirm([{ ref: run.first.pool_row.ref, dhash: run.first.pool_row.dhash }]);
    expect(held.reachedModel).toBe(false);
    expect(held.result.decision).toBe("firm_review");
    expect(held.result.decided_by).toBe("checks");
    expect(held.result.checks.C3.reason_technical).toContain("Only the 64-bit hash is compared across recalls and firms");
    const open = await sendToSecondFirm([]);
    expect(open.reachedModel).toBe(true);
  });
});
