/**
 * Records the shared hash pool working across two firms, for /evidence#network and the README. No model call, no
 * network, no database: the verifier itself (src/lib/verify) runs the code path a claim takes, with the pool rows the
 * claim route reads from image_hash.
 *
 *   npx tsx scripts/public/record-network-run.ts
 *
 * 1. Brightline Home (fictional sample firm) verified a claim on its sample recall BH-2026-01 with this photo: the
 *    recorded preset answer in content/presets/recorded/sample-charger-cut.json. After a claim, the route keeps the
 *    photo's 64-bit perceptual hash in image_hash (source "claim"), with the photo's row id and the recall number.
 * 2. The same photo is sent for Fernway Home's sample recall FW-2026-01 (a second fictional firm selling the same
 *    charger). The claim route reads every other recall's claim hashes, `ref` and `dhash` only, as `elsewhereHashes`;
 *    nothing else about Brightline's claim reaches Fernway. The run is given a model that records whether it was
 *    called, so the file shows the answer came before any model call.
 * 3. A control: the same photo for Fernway with the pool empty, which does go on to the model step.
 *
 * Writes content/public/network-run.json. tests/network-run.test.ts runs the same calls again and checks the file.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifyRecallFor } from "@/app/api/claims/_lib/recall";
import { recallByNumber, storedRule } from "@/lib/api/recall-data";
import { sampleFirmOf } from "@/lib/recall/label";
import { photoHashes, verifyPhoto, type VerifyResult } from "@/lib/verify";
import type { HashRef } from "@/lib/verify/types";
import { FIXTURES_DIR } from "@/lib/verify/fixtures";

export const NETWORK = { photo: "sample/cord-cut.jpg", first: "BH-2026-01", second: "FW-2026-01" } as const;
const OUT = path.join(process.cwd(), "content", "public", "network-run.json");

/** The photo sent for Fernway's recall with a given pool; `reachedModel` says whether the code went on to the model. */
export async function sendToSecondFirm(pool: readonly HashRef[]): Promise<{ result: VerifyResult; reachedModel: boolean }> {
  const recall = recallByNumber(NETWORK.second)!;
  let reachedModel = false;
  const result = await verifyPhoto(
    {
      photo: readFileSync(path.join(FIXTURES_DIR, NETWORK.photo)),
      recall: verifyRecallFor(recall),
      proofRule: storedRule(NETWORK.second)!.rule,
      elsewhereHashes: pool,
      claimContext: { firmAmount: { value: "29.99", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" }, firmName: sampleFirmOf(NETWORK.second) ?? undefined },
      options: { cache: false, reviewers: false },
    },
    {
      aiAvailable: () => true,
      cache: null,
      overBudget: async () => ({ over: false, usd: 0, budget: Infinity }),
      // Stands in for Claude: it never answers, it only notes that the code reached the model step.
      vision: async () => {
        reachedModel = true;
        throw new Error("not called in this recording");
      },
    },
  );
  return { result, reachedModel };
}

async function main() {
  const bytes = readFileSync(path.join(FIXTURES_DIR, NETWORK.photo));
  const { dhash } = await photoHashes(bytes);
  const brightline = JSON.parse(readFileSync(path.join(process.cwd(), "content", "presets", "recorded", "sample-charger-cut.json"), "utf8")) as { recorded_at: string; decision: string; decided_by: string };
  // The row Brightline's claim leaves in image_hash. Its id is a random UUID, as the photo table makes; it opens nothing at Fernway.
  const row = { source: "claim", ref: randomUUID(), recall_number: NETWORK.first, dhash };
  // What the claim route hands the verifier for Fernway's claim: ref and dhash, nothing else.
  const pool: HashRef[] = [{ ref: row.ref, dhash: row.dhash }];
  const held = await sendToSecondFirm(pool);
  const control = await sendToSecondFirm([]);
  const r = held.result;
  if (held.reachedModel || r.decision !== "firm_review" || r.checks.C3.status !== "fail") throw new Error(`Expected Fernway's claim to be held by the hash match before any model call; got ${r.decision} (${r.decided_by}), model reached: ${held.reachedModel}.`);
  const out = {
    note: "One photo, two firms: a photo already claimed at Brightline Home is sent for Fernway Home's recall and held for a person, because its 64-bit hash matches Brightline's claim. Both firms and both recalls are fictional samples. Recorded by scripts/public/record-network-run.ts with no model call, no network and no database; tests/network-run.test.ts runs it again.",
    recordedAt: new Date().toISOString(),
    photo: { file: `content/verify/fixtures/${NETWORK.photo}`, credit: "Dmitry G, Wikimedia Commons, public domain (public/samples/charger/CREDITS.json)" },
    first: {
      firm: sampleFirmOf(NETWORK.first),
      recall: NETWORK.first,
      claim: { decision: brightline.decision, decided_by: brightline.decided_by, recorded: "content/presets/recorded/sample-charger-cut.json", recorded_at: brightline.recorded_at },
      pool_row: row,
    },
    crossed: { fields: Object.keys(pool[0]), dhash, note: "The claim route reads every other recall's claim rows from image_hash as { ref, dhash } (src/app/api/claims/_lib/claims.ts). No photo, claimant, amount or recall crosses; ref is a row id that opens nothing at Fernway." },
    second: {
      firm: sampleFirmOf(NETWORK.second),
      recall: NETWORK.second,
      decision: r.decision,
      decided_by: r.decided_by,
      reached_model: held.reachedModel,
      c3: { status: r.checks.C3.status, plain: r.checks.C3.reason_plain, technical: r.checks.C3.reason_technical },
      summary: r.summary,
      timings: { decode_ms: r.timings.decode_ms, match_ms: r.timings.match_ms, total_ms: r.timings.total_ms },
    },
    control: { pool: 0, reached_model: control.reachedModel, note: "The same photo for Fernway with Brightline's hash left out of the pool goes on to the model step, so the hold above comes from the shared hash." },
    model_calls: 0,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`network run: ${out.second.firm} held the photo (${r.decision}, ${r.decided_by}) in ${r.timings.total_ms} ms; model reached: ${held.reachedModel}; control reached the model: ${control.reachedModel}`);
}

if (process.argv[1] && /record-network-run\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
