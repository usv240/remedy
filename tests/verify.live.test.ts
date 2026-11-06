import { describe, expect, it } from "vitest";
import { dhash, verifyPhoto, type VerifyResult } from "@/lib/verify";
import { fixtureFile, loadFixtureCases, loadFixtureRecalls, loadUserCases, meetsExpectation, type FixtureCase } from "@/lib/verify/fixtures";
import { loadOfficialImages } from "@/lib/verify/official";
import { runReviewers } from "@/lib/verify/reviewers";
import { decodeImage } from "@/lib/verify/image";

/**
 * Live run of verifyPhoto on the fixtures with Claude Opus 5.5. Skipped without ANTHROPIC_API_KEY.
 * Run: node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/verify.live.test.ts
 * Picks up the user's photos listed in content/verify/fixtures/user/expected.json.
 */

const KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const recalls = loadFixtureRecalls();
const timings: { id: string; decision: string; total: number; vision: number; reviewers: number; cacheRead: number }[] = [];

async function run(c: FixtureCase, effort?: "low" | "medium"): Promise<VerifyResult> {
  const { recall, rule } = recalls[c.recall];
  const priorHashes = await Promise.all((c.prior_from ?? []).map(async (f, i) => ({ ref: `prior-${i}:${f}`, dhash: await dhash(fixtureFile(f)) })));
  const r = await verifyPhoto({
    photo: fixtureFile(c.photo),
    recall,
    proofRule: rule,
    priorHashes,
    claimContext: { firmAmount: { value: "34.99", currency: "USD" }, autoCap: { value: "50.00", currency: "USD" } },
    // No verification cache here: each case should reach the model (AI_CACHE_DIR still replays identical requests).
    options: { effort, officialHashCheck: c.official_hash_check, cache: false },
  });
  timings.push({ id: c.id, decision: r.decision, total: r.timings.total_ms, vision: r.timings.vision_ms, reviewers: r.timings.reviewers_ms, cacheRead: r.usage.vision?.cache_read_input_tokens ?? 0 });
  return r;
}

function check(c: FixtureCase, r: VerifyResult) {
  const line = `${c.id}: ${r.decision} (${r.decided_by}) ${Object.values(r.checks).map((x) => `${x.id}=${x.status}${x.score !== undefined ? `:${x.score}` : ""}`).join(" ")} | ${r.summary.plain}`;
  console.log(line);
  // A live run is only meaningful if Claude answered; say why when it did not (for example an account with no credit).
  if (c.needs_vision && r.checks.C1.status === "unavailable") throw new Error(`Claude vision was unavailable, so this case could not be checked live. ${r.checks.C1.reason_technical}`);
  expect(meetsExpectation(c.expect, r).misses, line).toEqual([]);
}

describe.skipIf(!KEY)("verifyPhoto, live with Claude", () => {
  const cases = [...loadFixtureCases(), ...loadUserCases()];

  it.each(cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => check(c, await run(c)), 120_000);

  it("reads the recall block from the prompt cache on a repeat claim", async () => {
    const c = loadFixtureCases().find((x) => x.id === "unrelated-object")!;
    const r = await run({ ...c, id: "unrelated-object (repeat)" });
    check(c, r);
    expect(r.usage.vision?.cache_read_input_tokens ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it("times effort low against the default medium, for the under-10-second target", async () => {
    const c = loadFixtureCases().find((x) => x.id === "unrelated-object")!;
    const r = await run({ ...c, id: "unrelated-object (effort low)" }, "low");
    check(c, r);
  }, 120_000);

  it("runs the Two reviewers with cited evidence", async () => {
    const { recall, rule } = recalls["27056"];
    const photo = (await decodeImage(fixtureFile("other/commons-coffee-in-a-mug.jpg"))).jpeg;
    const { images } = await loadOfficialImages(recall.images);
    const run = await runReviewers({ photo, recall, rule, official: images });
    console.log(`reviewers: ${run.decision} in ${run.ms} ms. ${run.summary.technical}`);
    expect(run.decision).toBe("person");
    expect(run.reviews).toHaveLength(2);
    for (const v of run.votes) expect(v.answer).not.toBe("meets");
    timings.push({ id: "two reviewers (direct)", decision: run.decision, total: run.ms, vision: 0, reviewers: run.ms, cacheRead: 0 });
  }, 120_000);

  it("reports timings", () => {
    console.table(timings);
    const withVision = timings.filter((t) => t.vision > 0).map((t) => t.total).sort((a, b) => a - b);
    const noModel = timings.filter((t) => t.vision === 0 && t.reviewers === 0).map((t) => t.total).sort((a, b) => a - b);
    const median = (xs: number[]) => (xs.length ? xs[Math.floor((xs.length - 1) / 2)] : null);
    console.log(`median ms to a decision: with the vision call ${median(withVision)}, decided before any model call ${median(noModel)}`);
  });
});
