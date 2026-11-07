/**
 * Records verifyPhoto results for the public pages: the home page's "Try a photo" panel and the results band on
 * /judges. Run once; the pages read content/public/verify-runs.json and never call Claude themselves.
 *
 *   AI_CACHE_DIR=<dir> npx tsx --env-file=.env.local scripts/public/record-runs.ts [--vision] [--cap-usd 0.50 --since <ISO time>]
 *
 * Without --vision only the cases that need no model run (official images, rotated and cropped copies, an earlier
 * claim, a blurred photo): free and deterministic. --vision adds two live Claude calls (about $0.05 to $0.10 each,
 * reviewers off), replayed from AI_CACHE_DIR when it is set. With --cap-usd and --since, each live call first checks the
 * spend logged in ai_usage since that time and stops before the cap.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifyRecallFor } from "@/app/api/claims/_lib/recall";
import { capFromArgs, costUsd, spendSince } from "@/lib/ai/usage";
import type { ReviewRun } from "@/lib/verify/reviewers";
import type { VisionRun } from "@/lib/verify/vision";
import { recallByNumber, storedRule } from "@/lib/api/recall-data";
import { photoHashes, verifyPhoto, type VerifyRecall, type VerifyResult } from "@/lib/verify";
import { FIXTURES_DIR, fixtureFile, loadFixtureCases, loadFixtureRecalls } from "@/lib/verify/fixtures";

const vision = process.argv.includes("--vision");
const budget = capFromArgs(process.argv);
/** One vision call, with room to spare (the recorded ones cost $0.02 to $0.04). */
const PER_CALL_USD = 0.06;
async function withinCap(what: string) {
  if (!budget) return;
  const s = await spendSince(budget.since);
  if (s.usd + PER_CALL_USD > budget.cap) throw new Error(`Stopped before ${what}: $${s.usd.toFixed(4)} spent since ${budget.since.toISOString()}, cap $${budget.cap}.`);
}
const OUT = path.join(process.cwd(), "content", "public", "verify-runs.json");

const recalls = loadFixtureRecalls();
const fromData = (n: string, withImages: boolean): VerifyRecall => {
  const r = recallByNumber(n)!;
  return {
    number: r.number,
    title: r.title,
    description: r.description,
    remedyText: r.remedyText,
    products: r.products.map((p) => ({ name: p.name, model: p.model, description: p.description, type: p.type, units: p.units })),
    images: withImages ? r.images.map((i) => ({ url: i.url, caption: i.caption })) : [],
    units: r.units,
  };
};

type Run = {
  id: string;
  title: string;
  about: string;
  photo: string;
  recall: string;
  expect: string;
  needs_vision: boolean;
  settings?: string;
  result: Pick<VerifyResult, "decision" | "decided_by" | "summary" | "guidance" | "amount" | "model" | "timings"> & {
    checks: Record<string, { name: string; status: string; pass: boolean; score: number | null; reason: string; technical: string }>;
  };
  usd: number;
  ran_at: string;
};

const slim = (r: VerifyResult): Run["result"] => ({
  decision: r.decision,
  decided_by: r.decided_by,
  summary: r.summary,
  guidance: r.guidance,
  amount: r.amount,
  model: r.model,
  timings: r.timings,
  checks: Object.fromEntries(Object.values(r.checks).map((c) => [c.id, { name: c.name, status: c.status, pass: c.pass, score: c.score ?? null, reason: c.reason_plain, technical: c.reason_technical }])),
});

const usdOf = (r: VerifyResult) => [r.usage.vision, ...r.usage.reviewers].reduce((s, u) => s + costUsd(r.model ?? "claude-opus-5-5", u as never), 0);

const TITLES: Record<string, { title: string; about: string; expect: string }> = {
  "official-image-power-bank": { title: "The recall's own picture", about: "The CPSC's official photo of the HAIARA power bank, sent as if it were the owner's.", expect: "Asks for the owner's own photo" },
  "official-image-heater": { title: "The recall's own picture, heater", about: "The CPSC's official photo of the DREO space heater.", expect: "Asks for the owner's own photo" },
  "duplicate-rotated-official": { title: "Rotated and recompressed copy", about: "The official power bank photo turned 90 degrees, shrunk and saved again at low quality.", expect: "Still matched to the official picture" },
  "duplicate-tilted-official": { title: "Tilted and cropped copy", about: "The heater's label photo tilted 4 degrees and cropped 6 percent on each side.", expect: "Still matched to the official picture" },
  "duplicate-earlier-claim": { title: "A photo already used", about: "A copy of a photo that an earlier claim on this recall already sent.", expect: "Not verified: the photo was used before" },
  blurry: { title: "A blurry photo", about: "A photo with heavy blur, the way a shaky hand takes it.", expect: "Retake, with what to change" },
};

async function main() {
  const runs: Run[] = [];
  const at = new Date().toISOString();
  for (const c of loadFixtureCases()) {
    if (c.needs_vision) continue;
    const t = TITLES[c.id];
    if (!t) continue;
    const { recall, rule } = recalls[c.recall];
    const prior = (c.prior_from ?? []).map((f) => ({ ref: f, dhash: "" }));
    for (const p of prior) p.dhash = (await photoHashes(fixtureFile(p.ref))).dhash;
    const r = await verifyPhoto({ photo: fixtureFile(c.photo), recall, proofRule: rule, priorHashes: prior }, { aiAvailable: () => false });
    runs.push({ id: c.id, ...t, photo: c.photo, recall: c.recall, needs_vision: false, result: slim(r), usd: 0, ran_at: at });
    console.log(`${c.id}: ${r.decision} (${r.decided_by}) in ${r.timings.total_ms} ms`);
  }

  // 0. Brightline's sample charger with its cord cut (fictional sample recall BH-2026-01): the full automatic path,
  //    first in the panel. It replays the one recorded live answer (content/presets/recorded/sample-charger-cut.json,
  //    recorded by scripts/verify/precompute.ts), so it costs nothing; every check around that answer runs in code.
  const samplePath = path.join(process.cwd(), "content", "presets", "recorded", "sample-charger-cut.json");
  if (existsSync(samplePath)) {
    const rec = JSON.parse(readFileSync(samplePath, "utf8")) as { recorded_at: string; cost_usd: number; vision: VisionRun; reviews: ReviewRun | null };
    const sample = recallByNumber("BH-2026-01")!;
    const rs = await verifyPhoto(
      {
        photo: readFileSync(path.join(FIXTURES_DIR, "sample", "cord-cut.jpg")),
        recall: verifyRecallFor(sample),
        proofRule: storedRule("BH-2026-01")!.rule,
        claimContext: { firmAmount: { value: "34.99", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" }, firmName: "Brightline Home" },
        options: { cache: false },
      },
      { aiAvailable: () => false, cache: null, vision: async () => ({ ...rec.vision, replayed: true }), reviewers: rec.reviews ? async () => rec.reviews! : undefined },
    );
    // The panel shows the recorded live timings, not the replay's.
    rs.timings = { ...rs.timings, vision_ms: rec.vision.ms, reviewers_ms: rec.reviews?.ms ?? 0, total_ms: rs.timings.total_ms + rec.vision.ms + (rec.reviews?.ms ?? 0) };
    runs.unshift({
      id: "sample-charger-cut",
      title: "Brightline's sample charger, cord cut",
      about: "Public-domain photos of one charger, before and after its cord was cut (Dmitry G, Wikimedia Commons). Sample recall; fictional.",
      photo: "sample/cord-cut.jpg",
      recall: "BH-2026-01",
      expect: "Verified, then the refund goes out",
      needs_vision: true,
      settings: `Brightline Home's sample recall BH-2026-01, refund $34.99, auto-approve cap $50.00. One live Claude Opus 5.5 run recorded ${rec.recorded_at.slice(0, 10)} ($${rec.cost_usd.toFixed(4)}), replayed here.`,
      result: slim(rs),
      usd: 0,
      ran_at: rec.recorded_at,
    });
    console.log(`sample-charger-cut: ${rs.decision} (${rs.decided_by}), replayed from the recording`);
  }

  if (vision) {
    // 1. The CPSC's published example of a product made safe (recall 26125: the hair dryer with its cord cut).
    //    The match against the CPSC's own picture is off for this run, and the vision call sees the product text only,
    //    so the run shows what C1 and C2 read in the photo. With the match on, Remedy asks for the owner's own photo.
    const n = "26125";
    const rule = storedRule(n)!.rule;
    await withinCap("cord-cut-example");
    const r1 = await verifyPhoto(
      {
        photo: readFileSync(path.join(FIXTURES_DIR, "official", "26125-hair-dryer-cord-cut.png")),
        recall: fromData(n, false),
        proofRule: rule,
        claimContext: { firmAmount: { value: "34.99", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" }, firmName: "the firm" },
        options: { reviewers: false, officialHashCheck: false },
      },
      {},
    );
    runs.push({
      id: "cord-cut-example",
      title: "Cord cut in half",
      about: "The photo the CPSC published with recall 26125 to show the hair dryer made safe: its power cord cut in half.",
      photo: "official/26125-hair-dryer-cord-cut.png",
      recall: n,
      expect: "Right product, made safe",
      needs_vision: true,
      settings: "Own-photo match against the CPSC's picture turned off for this run, reviewers off, sample refund amount of $34.99.",
      result: slim(r1),
      usd: usdOf(r1),
      ran_at: at,
    });
    console.log(`cord-cut-example: ${r1.decision} (${r1.decided_by}) in ${r1.timings.total_ms} ms, $${usdOf(r1).toFixed(4)}`);

    // 2. An unrelated object against the power bank recall: the right-product check should fail.
    const { recall, rule: pbRule } = recalls["27056"];
    await withinCap("unrelated-object");
    const r2 = await verifyPhoto({ photo: fixtureFile("other/commons-coffee-in-a-mug.jpg"), recall, proofRule: pbRule, options: { reviewers: false } }, {});
    runs.push({
      id: "unrelated-object",
      title: "Something else entirely",
      about: "A photo of a coffee mug (Kurt Kaiser, CC0, Wikimedia Commons) sent for the power bank recall.",
      photo: "other/commons-coffee-in-a-mug.jpg",
      recall: "27056",
      expect: "Not the recalled product",
      needs_vision: true,
      settings: "Reviewers off.",
      result: slim(r2),
      usd: usdOf(r2),
      ran_at: at,
    });
    console.log(`unrelated-object: ${r2.decision} (${r2.decided_by}) in ${r2.timings.total_ms} ms, $${usdOf(r2).toFixed(4)}`);
  }

  let prev: { runs: Run[] } = { runs: [] };
  try {
    prev = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    /* first run */
  }
  const merged = [...runs, ...prev.runs.filter((p) => !runs.some((r) => r.id === p.id))];
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        note: "Recorded runs of verifyPhoto (src/lib/verify) on the fixture photos in content/verify/fixtures. Free cases need no model. Vision cases are live Claude Opus 5.5 calls, recorded once; the pages never call Claude. Written by scripts/public/record-runs.ts.",
        recordedAt: at,
        totalUsd: Math.round(merged.reduce((s, r) => s + r.usd, 0) * 10000) / 10000,
        runs: merged,
      },
      null,
      1,
    ),
  );
  console.log(`wrote ${OUT}: ${merged.length} runs`);
  if (budget) console.log(`Spent since ${budget.since.toISOString()}: $${(await spendSince(budget.since)).usd.toFixed(4)} (ai_usage).`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
