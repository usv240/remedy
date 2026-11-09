import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { answerChanges, checkTimes, errorRates, freeCaught, hashSpeed, heldBackStory, sweepSettings } from "@/components/evidence/errors";
import { concentrationWords } from "@/components/evidence/Money";
import { OUTCOMES, WHY_CLAIMS } from "@/components/evidence/Adoption";
import { KEYED_LINE } from "@/components/evidence/Settings";
import { MODEL } from "@/lib/ai/claude";
import { effortFor } from "@/lib/verify/vision";
import { reviewerComparison } from "@/components/evidence/reviewer-data";
import { hostedDailyUsd } from "@/lib/ai/hosted-budget";
import { dailyBudgetUsd } from "@/lib/ai/usage";
import { ENTERPRISE_FEATURES } from "@/components/firm/ag-license";
import { TOOLS } from "@/lib/mcp/tools";
import { ONBOARDING_TODAY } from "@/lib/paypal/onboarding";
import { perRefund } from "@/lib/pricing";
import { payerWords, STAND_IN } from "@/lib/recall/label";
import { payoutTiming } from "@/lib/payout-timing";
import { INFERENCES, PORTAL_WAITS, PROBLEM, RESEARCH } from "@/lib/research";
import { catalogCounts, catalogOfficialHashes } from "@/lib/verify/dhash";
import { derived, skipNeed, testsHash } from "../scripts/facts";

/**
 * One source for each figure the README, docs/*.md, TESTING.md and /evidence repeat: content/public/facts.json, written
 * by scripts/facts.ts after the suites run. This test fails when the file disagrees with the code it was counted from,
 * or when the README, a docs page or TESTING.md print a different figure. After adding tests, run
 * `npx tsx scripts/facts.ts`.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const FACTS = path.join(ROOT, "content", "public", "facts.json");
type Facts = {
  unitTests: { passed: number; skipped: number; failed: number; skippedNeeds: { database: number; claude: number; paypal: number; other: number }; testsHash: string };
  a11y: { pages: number; views: number; passed: number } | null;
  mcp: { tools: number; names: string[] };
  photoChecks: { freeCaught: number; freeTotal: number };
  errors: { wrongPay: { count: number; of: number; photos: number }; heldBack: { count: number; of: number; photos: number } };
  catalogPictures: number;
  catalog: { stored: number; distinctHashes: number; catalog: number };
  measured: { checkSeconds: number | null; payoutSeconds: number | null };
  payout: { min: number; max: number; runs: number; figure: string } | null;
  history: { first: string; latest: string; latestCommit: string; sentence: string } | null;
} & ReturnType<typeof derived>;
const facts = JSON.parse(readFileSync(FACTS, "utf8")) as Facts;
const README = read("README.md");
const TESTING = read("TESTING.md");
/** The long sections the README links to (docs/*.md), by file name. */
const DOCS = Object.fromEntries(
  readdirSync(path.join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f, read("docs", f)]),
) as Record<string, string>;
const doc = (name: string) => {
  expect(DOCS[name], `docs/${name} exists`).toBeDefined();
  return DOCS[name];
};
/** The README and every docs page, for checks that hold wherever a figure appears. */
const ALL = [README, ...Object.values(DOCS)];
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const int = (n: number) => n.toLocaleString("en-US");
const all = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m.slice(1));
const score = (n: number | null) => (n === null ? "none" : n.toFixed(2));
const range = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return lo === hi ? score(lo) : `${score(lo)} to ${score(hi)}`;
};
/**
 * Inside the run scripts/facts.ts makes to count the tests, the file still holds the last run's count, so the two checks
 * on that count pass without looking; every test still runs, so the count matches a plain `npm test`.
 */
const COUNTING = process.env.REMEDY_FACTS_RUN === "1";

describe("content/public/facts.json agrees with the code", () => {
  it("exists, and its unit-test run passed", () => {
    expect(existsSync(FACTS)).toBe(true);
    if (COUNTING) return;
    expect(facts.unitTests.failed).toBe(0);
    expect(facts.unitTests.passed).toBeGreaterThan(300);
  });

  it("counts the MCP tools in src/lib/mcp/tools.ts", () => {
    expect(facts.mcp).toEqual({ tools: TOOLS.length, names: TOOLS.map((t) => t.name) });
  });

  it("counts the photo checks and the two error rates from the recorded runs", () => {
    const free = freeCaught();
    expect(facts.photoChecks).toEqual({ freeCaught: free.caught, freeTotal: free.total });
    const e = errorRates();
    expect(facts.errors.wrongPay).toEqual({ count: e.wrongPay.count, of: e.wrongPay.of, photos: e.wrongPay.cases });
    expect(facts.errors.heldBack).toEqual({ count: e.heldBack.count, of: e.heldBack.of, photos: e.heldBack.cases });
  });

  it("counts the catalog of distinct published pictures, the photo check time from the recorded live calls, and the payout from both records", () => {
    expect(facts.catalogPictures).toBe(catalogOfficialHashes().length);
    // The catalog in three figures, from one function: stored pictures, distinct hash values, pictures distinct enough to tell their recall apart.
    expect(facts.catalog).toEqual(catalogCounts());
    expect(facts.catalog.catalog).toBe(facts.catalogPictures);
    expect(facts.catalog.catalog).toBeLessThanOrEqual(facts.catalog.distinctHashes);
    expect(facts.catalog.distinctHashes).toBeLessThanOrEqual(facts.catalog.stored);
    const items = (JSON.parse(read("content", "public", "measured.json")) as { items: { id: string; figure?: string }[] }).items;
    const pt = payoutTiming()!;
    expect(facts.measured).toEqual({ checkSeconds: checkTimes().about, payoutSeconds: pt.about });
    expect(facts.payout).toEqual({ min: pt.min, max: pt.max, runs: pt.runs, figure: pt.figure });
    // One source for how long a check takes: the recorded live calls, never a typed-in figure.
    expect(items.some((i) => i.id === "live-check")).toBe(false);
    // The payout's range and run count are counted, never typed: measured.json keeps only the first runs' record.
    expect(items.find((i) => i.id === "payout")?.figure).toBeUndefined();
  });

  it("holds the accessibility suite's last run, every page it covers at four views each, all passing", () => {
    const routes = /const routes = \[([^\]]+)\]/.exec(read("tests", "e2e", "pages-a11y.mjs"))?.[1].split(",").length ?? 0;
    expect(facts.a11y).not.toBeNull();
    expect(facts.a11y!.pages).toBe(routes);
    expect(facts.a11y!.views).toBe(routes * 4);
    expect(facts.a11y!.passed).toBe(facts.a11y!.views);
  });

  it("scores the sweep against the answers as they stood that day exactly as the sweep marked itself, and every revised case matches its listed answer", () => {
    for (const s of sweepSettings()) expect(s.atSweep, s.id).toEqual(s.markedAtSweep);
    const cases = (JSON.parse(read("content", "verify", "fixtures", "cases.json")) as { cases: { id: string; expect: unknown; revised?: string }[] }).cases;
    for (const a of answerChanges()) {
      const c = cases.find((x) => x.id === a.case);
      expect(c, a.case).toBeDefined();
      expect(c!.expect).toEqual(a.now);
      expect(c!.revised).toContain("content/verify/answer-changes.json");
    }
    // Every case marked revised is in the changelog: nothing moved silently.
    for (const c of cases.filter((x) => x.revised)) expect(answerChanges().map((a) => a.case)).toContain(c.id);
  });
});

describe("the README, docs/*.md and TESTING.md print the same figures", () => {
  it("unit tests", () => {
    if (COUNTING) return;
    for (const text of [doc("run-and-test.md"), TESTING]) {
      const found = all(text, /(\d[\d,]*) passed, (\d[\d,]*) skipped/g);
      expect(found.length).toBeGreaterThan(0);
      for (const [p, s] of found) expect([p, s]).toEqual([int(facts.unitTests.passed), int(facts.unitTests.skipped)]);
    }
    for (const text of ALL) for (const [p, s] of all(text, /(\d[\d,]*) passed, (\d[\d,]*) skipped/g)) expect([p, s]).toEqual([int(facts.unitTests.passed), int(facts.unitTests.skipped)]);
    // Each skipped test is counted by what it needs, and the parts add up.
    const n = facts.unitTests.skippedNeeds;
    expect(n.other).toBe(0);
    expect(n.database + n.claude + n.paypal).toBe(facts.unitTests.skipped);
    for (const text of [doc("run-and-test.md"), TESTING]) expect(text).toContain(`${n.database} need a database, ${n.claude} a Claude key and ${n.paypal} PayPal sandbox keys`);
  });

  it("the README and /firm say how a firm connects its PayPal today in one sentence", () => {
    expect(README).toContain(ONBOARDING_TODAY);
    expect(read("src", "app", "firm", "page.tsx")).toContain("{ONBOARDING_TODAY}");
    for (const f of ["src/app/firm/page.tsx", "src/lib/firm/info.ts"]) expect(read(...f.split("/"))).not.toMatch(/signs in through\s+PayPal(?:&rsquo;|')s Partner Referrals/);
  });

  it("the README's PayPal table and /stack say the same about onboarding firms", () => {
    const stack = read("src", "app", "stack", "page.tsx");
    for (const text of [README, stack]) {
      expect(text).toContain("Partner Referrals");
      expect(text).toContain("PayPal-Auth-Assertion");
      expect(text).toMatch(/403 `?NOT_AUTHORIZED`?/);
      expect(text).toContain("November 7, 2026");
    }
  });

  it("/evidence reads its unit-test figure from facts.json and types none of its own", () => {
    // The "How it is tested" list is one component; it imports the file and prints its fields, never a literal count.
    const tested = read("src", "components", "evidence", "Tested.tsx");
    expect(tested).toContain("content/public/facts.json");
    for (const field of ["f.unitTests.passed", "f.unitTests.skipped", "f.a11y.passed", "f.a11y.views", "f.mcp.tools"]) expect(tested).toContain(field);
    expect(tested).not.toMatch(/\b\d{2,}\b/);
    // The published count comes from a clean run: scripts/facts.ts never writes the figures of a run with a failure.
    expect(facts.unitTests.failed).toBe(0);
    // Nowhere else on the site is a unit-test count typed in.
    for (const f of ["src/app/evidence/page.tsx", "content/info.json", "src/components/tour/steps.ts"]) expect(read(...f.split("/"))).not.toMatch(/\d{3} unit tests|\d{3} tests pass/);
  });

  it("the unit-test counts were taken on the tests as they are now", () => {
    // A test added or changed after the count changes this fingerprint: run `npx tsx scripts/facts.ts` again.
    if (COUNTING) return;
    expect(facts.unitTests.testsHash, "tests changed since content/public/facts.json was written; run npx tsx scripts/facts.ts").toBe(testsHash());
    // Each suite that can skip is named in skipNeed, so its skipped tests are counted under what they need.
    for (const f of readdirSync(path.join(ROOT, "tests")).filter((x) => x.endsWith(".test.ts"))) {
      // verify-dhash skips only without content/recalls/image-hashes.json, which the repo commits.
      if (f !== "verify-dhash.test.ts" && /describe\.skipIf|it\.skipIf/.test(read("tests", f))) expect(skipNeed(f), f).not.toBe("other");
    }
  });

  it("accessibility page views and pages", () => {
    const a = facts.a11y!;
    for (const text of [...ALL, TESTING]) {
      for (const [n, of] of all(text, /(\d+) of (\d+) page views/g)) expect([n, of]).toEqual([String(a.passed), String(a.views)]);
      for (const [n] of all(text, /All (\d+) page views/g)) expect(n).toBe(String(a.views));
      for (const [n] of all(text, /(\d+) pages(?: at|,) phone and desktop/g)) expect(n).toBe(String(a.pages));
    }
    expect(doc("run-and-test.md")).toContain(`${a.passed} of ${a.views} page views`);
  });

  it("MCP tools", () => {
    const word = WORDS[facts.mcp.tools];
    const how = doc("how-it-works.md");
    for (const text of ALL) for (const [w] of all(text, /with (\w+) tools:/g)) expect(w).toBe(word);
    expect(how).toContain(`with ${word} tools:`);
    for (const name of facts.mcp.names) {
      expect(how).toContain(`\`${name}\``);
      expect(TESTING).toContain(`\`${name}\``);
    }
    const info = JSON.parse(read("content", "info.json")) as Record<string, { technical?: string }>;
    for (const name of facts.mcp.names) expect(info["dev.mcp"].technical).toContain(name);
  });

  it("the photo checks and the error rates' decisions settled in code are the same runs, said in one line", () => {
    const e = errorRates();
    const free = freeCaught();
    // Code settled exactly the photo-check runs that needed no model call; every other decision was the model's.
    expect(e.inCode).toBe(free.total);
    expect(e.byModel + e.inCode).toBe(e.decisions);
    expect(README).toContain(`**${free.caught} of ${free.total}** stopped by code alone, before any AI call ([\`content/public/verify-runs.json\`](content/public/verify-runs.json)). They are the ${e.inCode} of the error rates' ${e.decisions} decisions settled in code; the model made the other ${e.byModel}.`);
    const rates = read("src", "components", "evidence", "ErrorRates.tsx");
    expect(rates).toContain("{e.byModel} by the model and {e.inCode} settled in code before any model call: the same {fc.total} recorded runs as the photo checks&rsquo; {fc.caught} of {fc.total} stopped by code alone.");
    expect(rates).not.toMatch(/n\("public"\)\} settled in code/);
  });

  it("the photo checks, the error rates and the catalog", () => {
    const f = facts.photoChecks;
    const e = facts.errors;
    for (const text of [README, doc("results.md")]) {
      expect(text).toContain(`**${f.freeCaught} of ${f.freeTotal}** stopped by code alone`);
      expect(text).toContain(`**paid when it should not have been: ${e.wrongPay.count} of ${e.wrongPay.of}** decisions, on ${e.wrongPay.photos} photos`);
      expect(text).toContain(`**held for a person or a new photo when it could have been paid: ${e.heldBack.count} of ${e.heldBack.of}**`);
    }
    for (const text of ALL) {
      for (const [n, of] of all(text, /(\d+) of (\d+) paid wrongly/g)) expect([n, of]).toEqual([String(e.wrongPay.count), String(e.wrongPay.of)]);
      // The catalog figure always comes with its definition: the pictures distinct enough to tell their recall apart, of the pictures stored.
      for (const [n] of all(text, /the ([\d,]+) (?:distinct )?published pictures of every recall/g)) expect(n).toBe(int(facts.catalog.catalog));
      for (const [n] of all(text, /\(of ([\d,]+) stored\)/g)) expect(n).toBe(int(facts.catalog.stored));
      for (const [n] of all(text, /the ([\d,]+) published pictures of other recalls that are distinct enough/g)) expect(n).toBe(int(facts.catalog.catalog));
      expect(text).not.toMatch(/[\d,]+ distinct pictures of every other recall/);
      expect(text).not.toMatch(/distinct published pictures of every recall and every photo/);
    }
    expect(README).toContain(`the ${int(facts.catalog.catalog)} published pictures of every recall that are distinct enough to tell their recall apart (of ${int(facts.catalog.stored)} stored)`);
  });

  it("the reviewer comparison's decisions and the error rates' decisions are counted from one set, and the docs say how they differ", () => {
    const e = errorRates();
    const c = reviewerComparison();
    const known = c.rows.filter((r) => r.known !== "reading").length;
    const reading = c.rows.length - known;
    const code = e.bySource.find((b) => b.source === "public")?.decisions ?? 0;
    // The error rates' model decisions are exactly the reviewer rows with a known answer.
    expect(e.decisions - code).toBe(known);
    const modelPublic = code - e.inCode;
    expect(modelPublic).toBe(1);
    expect(doc("results.md")).toContain(
      `Of ${c.rows.length} recorded model decisions at the claim path's setting, ${c.reached.length} reached the two reviewers. (The ${c.rows.length} are the ${known} decisions with a known answer that the error rates below also count, and ${reading} readings of the CPSC's own photos, which count in neither rate; the error rates' ${e.decisions} decisions are those ${known} and ${code} public runs: ${e.inCode} settled in code with no model call, and ${modelPublic}, a photo of a mug, read by the model with the reviewers off.)`,
    );
    // Every row that reached the reviewers is accounted for: the known answers in the two rates, and the readings.
    const r = c.referee;
    const readingsReached = c.reached.filter((x) => x.known === "reading").length;
    expect(r.notPaid + r.paid + readingsReached).toBe(c.reached.length);
    expect(doc("results.md")).toContain(
      `Of the ${c.reached.length} that reached the reviewers, ${r.notPaid} had a known answer of no payment and the referee paid neither (${r.wrongPay} of ${r.notPaid}); ${r.paid} had a known answer to pay and it held ${r.wrongHold} (${r.wrongHold} of ${r.paid}); the seventh was a reading of the CPSC's own photo, which counts in neither rate, and the referee sent it to a person.`,
    );
    expect(readingsReached).toBe(1);
    expect(read("src", "components", "evidence", "ErrorRates.tsx")).toContain("{e.byModel} by the model and {e.inCode} settled in code");
  });

  it("who pays on a real CPSC recall: one sentence on the claim page's footer and in the README", () => {
    expect(README).toContain(STAND_IN);
    expect(payerWords("27056").demo).toBe(STAND_IN);
    expect(read("src", "app", "claim", "[recall]", "page.tsx")).toContain("payerWords(pr.number).demo");
    // What the code does: a claim's firm with no connected PayPal app pays from the platform's account.
    expect(read("src", "lib", "paypal", "firm-account.ts")).toMatch(/null pays from the platform account/);
  });

  it("the one-photo positive case is stated plainly wherever the held-back rate appears", () => {
    const h = heldBackStory();
    expect(h.photos).toBe(1);
    expect(h.score).toBe(range(facts.references.after));
    expect(h.pass).toBe("0.85");
    expect(doc("results.md")).toContain(h.sentence.replace(/\.$/, ""));
    // The README lists the same story one fact a line.
    for (const line of h.bullets) expect(README).toContain(`  - ${line}`);
    expect(read("src", "components", "evidence", "ErrorRates.tsx")).toContain("heldBackStory().sentence");
  });

  it("the claim path's setting is the one every recording and the cache are keyed to, set in one line", () => {
    expect(effortFor(MODEL, undefined)).toBe("medium");
    const recordings = readdirSync(path.join(ROOT, "content", "presets", "recorded")).filter((f) => f.endsWith(".json"));
    for (const f of recordings) expect((JSON.parse(read("content", "presets", "recorded", f)) as { engine: string }).engine, f).toMatch(/:claude-opus-5-5:medium$/);
    expect(read("src", "lib", "verify", "vision.ts").match(/return model === MODEL \? "medium" : undefined;/g)).toHaveLength(1);
    expect(KEYED_LINE).toContain("effortFor() in src/lib/verify/vision.ts");
    expect(doc("results.md")).toContain("`effortFor()` in [`src/lib/verify/vision.ts`]");
  });

  it("the README opens on a three-image strip from docs/img, with alt text, then a first paragraph of at most three short sentences", () => {
    const blocks = README.split(/\r?\n\r?\n/);
    const strip = blocks.findIndex((b) => b.startsWith("<p>") && b.includes("<img"));
    expect(strip).toBeGreaterThan(0);
    expect(strip).toBeLessThan(4);
    const imgs = [...blocks[strip].matchAll(/<img src="(docs\/img\/[\w.-]+)" alt="([^"]+)"/g)];
    expect(imgs).toHaveLength(3);
    for (const [, src, alt] of imgs) {
      expect(existsSync(path.join(ROOT, src)), src).toBe(true);
      expect(alt.split(" ").length).toBeGreaterThan(3);
    }
    const intro = blocks[strip + 1];
    const sentences = intro.split(/(?<=\.)\s+(?=[A-Z])/);
    expect(sentences.length).toBeLessThanOrEqual(3);
    for (const x of sentences) expect(x.split(/\s+/).length).toBeLessThan(25);
    expect(intro).toContain("https://remedy-y0ym.onrender.com");
    // The figures come straight after it.
    expect(blocks[strip + 2].startsWith("Since January 2024")).toBe(true);
  });

  it("the README's first paragraph states the problem: the recalls, the money at stake and the check wait", () => {
    const d = derived();
    const first = README.split(/\r?\n\r?\n/).find((p) => p.startsWith("Since January 2024")) ?? "";
    expect(README.indexOf(first)).toBeLessThan(README.indexOf("- **In 30 seconds:**"));
    expect(first).toContain(`**${d.headline.madeSafeRefund}** US consumer product recalls`);
    expect(first).toContain(`**${d.value.total}** in refunds at the lowest stated price`);
    expect(first).toContain(`pays by check within ${RESEARCH.portal.days}`);
  });

  it("the sample preset says what its recorded runs measured, not a promise of the automatic path", () => {
    const h = heldBackStory();
    const preset = (JSON.parse(read("content", "presets", "index.json")) as { presets: { id: string; summary: string; expected: { plain: string } }[] }).presets.find((p) => p.id === "sample-charger-cut")!;
    const times = (n: number) => (n === 1 ? "once" : `${WORDS[n] ?? n} times`);
    expect(preset.summary).toContain(`Measured on its ${h.of} recorded runs: verified ${h.paid} times, through the two reviewers, and sent to a person at the firm ${times(h.toPerson)}.`);
    expect(preset.summary).not.toMatch(/full automatic path/);
    expect(preset.expected.plain).not.toMatch(/on a real claim/);
  });

  it("one story for the free answers' times, from the recorded runs, and no figure they do not support", () => {
    const d = derived();
    expect(facts.timings).toEqual(d.timings);
    expect(d.timings.sentence).toBe(hashSpeed().sentence);
    expect(README).toContain(d.timings.sentence);
    expect(doc("results.md")).toContain(d.timings.sentence);
    // Every "median of N ms" anywhere is one of the two recorded medians: the hash comparison or the whole answer.
    const medians = [d.timings.match.median, d.timings.free.median].map((n) => `${n.toLocaleString("en-US")}`);
    for (const text of ALL) for (const [n] of all(text, /median of ([\d.,]+) ms/g)) expect(medians).toContain(n);
    for (const text of [...ALL, TESTING, read("content", "info.json")]) expect(text).not.toMatch(/about 60 ms|under 100 ms|answers that picture in a median of/);
  });

  it("one story for how long a photo check takes, from every recorded live call", () => {
    const d = derived();
    expect(facts.checkTimes).toEqual(d.checkTimes);
    const ct = d.checkTimes;
    expect(README).toContain(`the photo check in **about ${ct.about} seconds**`);
    expect(doc("results.md")).toContain(`takes about ${ct.about} seconds: a median of ${ct.check.median} s, ${ct.check.min} to ${ct.check.max} s across ${ct.check.n} recorded live checks`);
    expect(doc("results.md")).toContain(`the two reviewers add a median of ${ct.reviewers.median} s (${ct.reviewers.min} to ${ct.reviewers.max} s in ${ct.reviewers.n} runs)`);
    for (const text of ALL) for (const [n] of all(text, /check (?:runs )?in (?:\*\*)?about (\d+) seconds/g)) expect(n).toBe(String(ct.about));
    for (const text of ALL) expect(text).not.toMatch(/12\.3 seconds for one live photo check/);
  });

  it("the hosted AI budget, from render.yaml", () => {
    const usd = hostedDailyUsd();
    expect(usd).not.toBeNull();
    expect(facts.hostedAiDailyUsd).toBe(usd);
    // The code's own hosted default, render.yaml and the comment in .env.example say the same number.
    expect(dailyBudgetUsd({ RENDER: "true" })).toBe(usd);
    const envExample = read(".env.example");
    expect(envExample).toContain(`Default ${usd} when hosted`);
    expect(envExample).not.toMatch(new RegExp(`Default (?!${usd}\\b)\\d+ when hosted`));
    let seen = 0;
    for (const text of ALL) {
      for (const [n] of [...all(text, /\$(\d+(?:\.\d+)?) of Claude a day/g), ...all(text, /\$(\d+(?:\.\d+)?) a day on the hosted site/g)]) {
        expect(Number(n)).toBe(usd);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it(".env.example describes the claims queue without a license key the way the code and /api/health do", () => {
    const envExample = read(".env.example");
    const health = read("src", "lib", "health.ts");
    expect(envExample).toContain("AG Grid Community, with no license notice");
    expect(envExample).not.toMatch(/enterprise trial/i);
    expect(health).toContain("AG Grid Community");
    expect(health).toContain("ENTERPRISE_FEATURES");
    expect(ENTERPRISE_FEATURES.length).toBeGreaterThan(20);
    // Webhook trust is described as the code does it: a signature, or PayPal's own copy of the event looked up by id.
    const webhooks = read("src", "lib", "payments", "webhooks.ts");
    expect(webhooks).toMatch(/method: "signature" \| "lookup"/);
    expect(health).toMatch(/by its signature, or by looking the event up at PayPal/);
    for (const text of [read("src", "app", "stack", "page.tsx"), read("content", "info.json"), health]) expect(text).not.toMatch(/signature-checked/);
  });

  it("who pays, Venmo in the sandbox, and the end-to-end transcript", () => {
    // Who pays Remedy: the README and the pilot say the same, with the two issuer figures from src/lib/research.ts.
    expect(README).toContain("**Who pays Remedy:** the firm, a fee per finished claim.");
    const pilot = read("src", "app", "evidence", "market", "page.tsx") + read("src", "components", "evidence", "Adoption.tsx");
    expect(pilot).toContain("Who pays Remedy:");
    expect(pilot).toContain("PROBLEM.checkCost.cost");
    // The proposed fee, labelled a proposal, beside what a refund costs a firm today: one sentence, from src/lib/pricing.ts.
    const fee = perRefund();
    expect(fee.sentence).toMatch(/^Proposed: .* \(a proposal, not a price list\)/);
    expect(fee.checkLow).toBeGreaterThan(Number(fee.withRemedy.slice(1)));
    expect(README).toContain(fee.sentence.replace(/\.$/, ""));
    expect(pilot).toContain("perRefund().sentence");
    // The pilot measures the claim rate first, with its baseline and the one line on why, from src/lib/research.ts.
    expect(OUTCOMES[0]).toMatchObject({ rank: "Primary" });
    expect(OUTCOMES[0].what).toMatch(/^Claim rate/);
    expect(OUTCOMES[1]).toMatchObject({ rank: "Secondary", what: "Time from photo to refund" });
    const research = doc("research.md");
    expect(research).toContain(`**Why more completed claims:** ${WHY_CLAIMS.replace(/\.$/, "")}`);
    for (const fig of [RESEARCH.comeBack.share, PROBLEM.correctionRate.rate, PROBLEM.correctionRate.target]) expect(OUTCOMES[0].baseline + WHY_CLAIMS).toContain(fig);
    expect(research).toContain(OUTCOMES[0].baseline.replace(/\.$/, ""));
    // Venmo: the sandbox refuses the wallet and the payout is resent by phone; the README says so wherever it offers Venmo.
    const payouts = read("src", "lib", "payments", "payouts.ts");
    expect(payouts).toContain('recipient_wallet: "VENMO"');
    expect(payouts).toMatch(/walletRefused/);
    for (const m of README.matchAll(/or Venmo.{0,400}/g)) expect(m[0]).toMatch(/sandbox/);
    expect(read("src", "components", "claim", "Payout.tsx")).toContain("recipient_wallet VENMO");
    // The end-to-end transcript: both suites, the last run of each passed, no email and no secret in it.
    const file = path.join(ROOT, "content", "public", "e2e-transcript.json");
    expect(existsSync(file)).toBe(true);
    const t = JSON.parse(readFileSync(file, "utf8")) as { suites: Record<string, { passed: number; failed: number; steps: unknown[]; ids: Record<string, unknown> }> };
    expect(Object.keys(t.suites).sort()).toEqual(["claim", "claim-shop", "try-payout"]);
    for (const s of Object.values(t.suites)) {
      expect(s.failed).toBe(0);
      expect(s.steps.length).toBeGreaterThan(5);
      expect(s.passed).toBe(s.steps.length);
    }
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toMatch(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[A-Za-z]{2,}/);
    expect(raw).not.toMatch(/rm_test_[A-Za-z0-9]{20,}|localhost:\d+/);
    expect(t.suites["claim-shop"].ids.refund_id).toBeTruthy();
    expect(t.suites.claim.ids.payout_item_id).toBeTruthy();
    // The one-click sandbox payout on /try: one real sandbox payout, its batch id, and PayPal reporting it paid.
    expect(t.suites["try-payout"].ids).toMatchObject({ amount: "34.99", route: "payout" });
    expect(t.suites["try-payout"].ids.payout_batch_id).toBeTruthy();
    expect(t.suites["try-payout"].ids.payout_status).toBe("SUCCESS");
    for (const text of [README, doc("results.md")]) expect(text).toContain("content/public/e2e-transcript.json");
  });

  it("the model settings, scored as they stood the day of the sweep first, then re-scored beside the dated revisions", () => {
    const d = derived();
    expect(facts.settings).toEqual(d.settings);
    expect(facts.answerChanges).toEqual(d.answerChanges);
    const claim = d.settings.find((s) => s.id === "opus-medium")!;
    const low = d.settings.find((s) => s.id === "opus-low")!;
    const sonnet = d.settings.find((s) => s.id === "sonnet-default")!;
    const r = doc("results.md");
    expect(r).toContain("content/verify/answer-changes.json");
    expect(r).toContain(`the claim path's setting was right on **${claim.atSweep}** (Opus at low effort ${low.atSweep}, Sonnet 5.5 ${sonnet.atSweep})`);
    expect(r).toContain(`Re-scored with today's answers: ${claim.correct}, Opus at low effort and Sonnet 5.5 ${low.correct}`);
    expect(low.correct).toBe(sonnet.correct);
    expect(r).toContain(`(${claim.wrongPay} each)`);
    expect(r).toContain(`$${low.usdPerCase} a check against $${claim.usdPerCase}`);
    const e = facts.errors.heldBack;
    expect(r).toContain(`the sample charger, paid in ${e.of - e.count} of ${e.of}`);
    // Day-of-sweep first: the day-of-sweep score is printed before the re-scored one.
    expect(r.indexOf(claim.atSweep)).toBeLessThan(r.indexOf(claim.correct));
  });

  it("the sample recall's reference pictures, before and after", () => {
    const d = derived();
    expect(facts.references).toEqual(d.references);
    const ref = d.references;
    const r = doc("results.md");
    expect(r).toContain(`scored ${range(ref.before)} on the right-product check in all ${ref.before.length} runs`);
    expect(r).toContain(`the score is ${range(ref.after)} in ${ref.after.length} runs`);
    expect(r).toContain(`${ref.afterVerified} of the ${ref.after.length} were verified`);
    expect(r).toContain("content/verify/sample-references.json");
  });

  it("one photo, two firms: the recorded cross-firm run", () => {
    const d = derived();
    expect(facts.network).toEqual(d.network);
    expect(d.network).toMatchObject({ firstFirm: "Brightline Home", secondFirm: "Fernway Home", decision: "firm_review", decidedBy: "checks", reachedModel: false, controlReachedModel: true, crossed: ["ref", "dhash"] });
    for (const text of [README, doc("results.md")]) {
      expect(text).toContain("content/public/network-run.json");
      expect(text).toContain("held for a person before any model call");
      expect(text).toContain("only the hash and a row id cross");
    }
  });

  it("the reading accuracy, the photo count and the money headline", () => {
    const d = derived();
    expect(facts.reading).toEqual(d.reading);
    expect(facts.multiPhoto).toEqual(d.multiPhoto);
    expect(facts.value).toEqual(d.value);
    const r = d.reading;
    expect(doc("results.md")).toContain(`**Reading accuracy on real CPSC recalls: ${r.right} of ${r.readings} readings right`);
    expect(doc("results.md")).toContain(`right product ${r.product} of ${r.trials}, made safe ${r.madeSafe} of ${r.trials}`);
    expect(doc("results.md")).toContain(`${d.multiPhoto.count} of the ${d.multiPhoto.of} ask for more than one photo`);
    expect(README).toContain(`those ${d.value.recalls} recalls offer **${d.value.total}** in refunds`);
    expect(README).toContain(`**${d.value.unclaimed}** of it stays unclaimed`);
    expect(README).toContain(`sends **${d.value.perPoint}** back to owners`);
    // What stays unclaimed is a range at two published rates, each named with what it measures (README and /evidence/market).
    expect(README).toContain(`**${d.value.unclaimedAtCorrection}** to **${d.value.unclaimed}** of it stays unclaimed: the lower figure at the CPSC's FY2025 average correction rate across recalls (${d.value.correctionRate}), the higher if about ${RESEARCH.comeBack.share} recalled units come back`);
    expect(d.value.correctionRate).toBe(PROBLEM.correctionRate.rate);
    const money = read("src", "components", "evidence", "Money.tsx");
    for (const field of ["VALUE.unclaimedLowUsd", "VALUE.unclaimedAtCorrectionLowUsd", "PROBLEM.correctionRate.rate", "RESEARCH.comeBack.share"]) expect(money).toContain(field);
    // The lower end of the unclaimed range leads, wherever both ends are printed.
    for (const text of [...ALL, money, read("src", "app", "page.tsx")]) {
      const lo = text.indexOf(d.value.unclaimedAtCorrection);
      const hi = text.indexOf(d.value.unclaimed);
      if (lo >= 0 && hi >= 0) expect(lo).toBeLessThan(hi);
    }
    expect(money.indexOf("{m.unclaimedAtCorrection}")).toBeLessThan(money.indexOf("{m.unclaimed}"));
    // Concentration, computed from value.json: the two largest recalls' share and the median recall, one sentence.
    const value = JSON.parse(read("content", "recalls", "value.json")) as { lowUsd: number; largest: { number: string; usd: number }[]; concentration: { topTwoUsd: number; topTwoShare: number; medianUsd: number } };
    expect(value.concentration.topTwoUsd).toBe(value.largest[0].usd + value.largest[1].usd);
    expect(value.concentration.topTwoShare).toBe(Math.round((value.concentration.topTwoUsd / value.lowUsd) * 1000) / 10);
    expect(value.concentration.medianUsd).toBeGreaterThan(0);
    const conc = concentrationWords();
    expect(conc).toContain(`(${value.concentration.topTwoShare.toFixed(1)}%)`);
    expect(README).toContain(conc.replace(/\.$/, ""));
    expect(doc("results.md")).toContain(conc.replace(/\.$/, ""));
    // The arithmetic closes: covered plus the two kinds left out is the whole, and the README says all three.
    expect(d.value.covered + d.value.proRated + d.value.noPrice).toBe(d.value.recalls);
    const leftOut = `(${d.value.covered} of ${d.value.recalls} state units and a price; ${d.value.proRated} pro-rated refunds state no share and ${d.value.noPrice} records state no price, so those ${d.value.proRated + d.value.noPrice} are left out)`;
    expect(README).toContain(leftOut);
    expect(doc("results.md")).toContain(`${d.value.covered} counted; ${d.value.proRated} pro-rated refunds state no share and ${d.value.noPrice} records state no price, so those ${d.value.proRated + d.value.noPrice} are left out`);
    // The headline count, its share and its years, read through each recall's proof rule (content/recalls/proof-split.json).
    const h = d.headline;
    expect(facts.headline).toEqual(h);
    expect(h.madeSafeRefund).toBe(d.value.recalls);
    expect(README).toContain(`**${h.madeSafeRefund} of ${int(h.recalls)}** US consumer product recalls since January 2024 (${h.share}%)`);
    expect(README).toContain(`${h.byYear["2024"]} in 2024, ${h.byYear["2025"]} in 2025 and ${h.byYear["2026"]} in 2026 so far`);
    expect(README).toContain(`of the ${h.photoRefund} whose remedy names a photo and a refund, ${h.madeSafeRefund} ask for the product made safe and pay a refund for it, ${h.otherPhoto} ask for a photo of the product as it is`);
    expect(README).toContain(`${h.madeSafeCredit} pay store credit and ${h.noPhoto} need no photo`);
    const r2 = doc("results.md");
    expect(r2).toContain(`${h.madeSafeRefund + h.madeSafeCredit} ask for a photo of the product made safe, of which ${h.madeSafeRefund} pay a refund for it (the headline) and ${h.madeSafeCredit} pay store credit`);
    expect(r2).toContain(`${h.otherPhoto} ask for a photo for another reason`);
    expect(r2).toContain(`The ${h.madeSafeRefund} recalls offer ${d.value.total} in refunds`);
    // No headline anywhere says every photo-refund recall refunds a made-safe photo.
    for (const text of [...ALL, TESTING]) expect(text).not.toMatch(new RegExp(`${h.photoRefund} (?:of [\d,]+ )?(?:US )?(?:consumer )?(?:product )?recalls[^.]{0,60}(?:offer|refund)[^.]{0,40}made safe`));
  });

  it("the research, framed as what it measures, and the measured contrast the impact story leads with", () => {
    for (const fig of [RESEARCH.fullRemedy.lift, `${RESEARCH.simpler.from} to ${RESEARCH.simpler.to}`, RESEARCH.simpler.named, RESEARCH.comeBack.share]) expect(README).toContain(fig);
    expect(README).toContain(`Across ${RESEARCH.fullRemedy.recalls} CPSC recalls from ${RESEARCH.fullRemedy.years}`);
    expect(README).toContain(`had not claimed ${RESEARCH.simpler.benefit} after a first notice`);
    for (const text of ALL) expect(text).not.toMatch(/a full refund lifts/i);
    // The contrast: the portal's own words and page, against the payout measured in the sandbox.
    const pt = payoutTiming()!;
    const payout = pt.seconds;
    expect(RESEARCH.portal.quote).toContain("10-15 business days");
    expect(README).toContain(`"via check within 10-15 business days"`);
    expect(README).toContain(RESEARCH.portal.url);
    expect(README).toContain(`**${payout}** after approval, in ${pt.runs} sandbox runs`);
    // Wherever a payout range and its runs are printed, they are the ones counted from both records.
    for (const text of [...ALL, TESTING]) {
      for (const [a, b] of all(text, /(\d+) to (\d+) seconds (?:from )?(?:after )?approval/g)) expect([Number(a), Number(b)]).toEqual([pt.min, pt.max]);
      for (const [n] of all(text, /in (\d+) (?:PayPal )?sandbox runs/g)) expect(Number(n)).toBe(pt.runs);
      for (const [a, b] of all(text, /reached SUCCESS (\d+) to (\d+) seconds/g)) expect([Number(a), Number(b)]).toEqual([pt.min, pt.max]);
    }
    expect(README.indexOf("**The difference:**")).toBeLessThan(README.indexOf("Reaching the owner directly"));
    expect(doc("research.md")).toContain(RESEARCH.portal.url);
    expect(doc("research.md")).toContain(payout);
    const research = doc("research.md");
    for (const fig of [RESEARCH.directNotice.direct, RESEARCH.directNotice.press, RESEARCH.euStudy.direct, RESEARCH.euStudy.generic, RESEARCH.fullRemedy.lift]) expect(research).toContain(fig);
    expect(README).toContain(`the PayPal payout in **about ${facts.measured.payoutSeconds}**`);
  });

  it("the portal waits are a table of pages already read, each with its source and date, beside the payout measured in the sandbox", () => {
    expect(PORTAL_WAITS.map((w) => w.url)).toEqual([RESEARCH.portal.url, PROBLEM.weeksPortal.url, PROBLEM.paypalPortal.url]);
    for (const w of PORTAL_WAITS) {
      expect(w.date).toMatch(/20\d\d/);
      // Each page is one docs/research.md already cites.
      expect(doc("research.md"), w.id).toContain(w.url);
    }
    const contrast = read("src", "components", "evidence", "Contrast.tsx");
    expect(contrast).toContain("PORTAL_WAITS.map");
    expect(contrast).toContain("Remedy, in the ${c.environment}");
    for (const f of ["src/app/page.tsx", "src/app/evidence/page.tsx", "src/app/evidence/market/page.tsx"]) expect(read(...f.split("/")), f).toContain("<Contrast");
    for (const w of PORTAL_WAITS.slice(1)) expect(README).toContain(w.url);
  });

  it("the two inferences are said as inferences wherever their figures appear", () => {
    const market = read("src", "app", "evidence", "market", "page.tsx");
    expect(market).toContain("{INFERENCES.unclaimed}");
    expect(market).toContain("{INFERENCES.claims}");
    expect(README).toContain(INFERENCES.unclaimed);
    expect(README).toContain(INFERENCES.claims);
    // Each sits right after the figures it qualifies.
    expect(README.indexOf(INFERENCES.unclaimed)).toBeGreaterThan(README.indexOf("of it stays unclaimed"));
    expect(README.indexOf(INFERENCES.claims)).toBeGreaterThan(README.indexOf(`**${RESEARCH.simpler.named}**`));
  });

  it("the README stays short: its top screen and the three ideas, with the long sections in docs/*.md", () => {
    const words = README.split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThan(2000);
    for (const heading of ["## Run it yourself", "## Results", "## Where to look", "## PayPal, file by file", "## The problem, and the result", "## Three ideas at its heart", "## See it", "## Read more"]) expect(README).toContain(heading);
    for (const name of Object.keys(DOCS)) expect(README).toContain(`docs/${name}`);
    // The CI badge points at the workflow that exists, and the quickstart states the no-keys test count (checked above).
    expect(README).toContain("actions/workflows/ci.yml/badge.svg");
    expect(existsSync(path.join(ROOT, ".github", "workflows", "ci.yml"))).toBe(true);
    expect(README).toMatch(/npm test\s+# \d+ passed, \d+ skipped without a database or keys/);
    // Every screenshot the README shows is in docs/img, and the two PayPal ones are among them.
    const images = all(README, /\]\((docs\/img\/[\w.-]+)\)/g).map(([p]) => p);
    expect(images).toContain("docs/img/5-refund-to-purchase.png");
    expect(images).toContain("docs/img/6-two-reviewers.png");
    for (const img of images) expect(existsSync(path.join(ROOT, img)), img).toBe(true);
    // Every repo path the README links to exists.
    for (const [p] of all(README, /\]\(((?:src|content|tests|scripts|docs|public|\.github)\/[\w./\-[\]]+)\)/g)) expect(existsSync(path.join(ROOT, p)), p).toBe(true);
    // The submission-period sentence names the first and latest commit dates.
    expect(README).toMatch(/first commit is dated November \d+, 2026 and the latest November \d+, 2026/);
  });

  it("figures that could be read two ways say which they are, and the history sentence is computed", () => {
    // 1,779 is the whole catalog of distinct published pictures; the reuse run compares each photo with every other
    // recall's pictures, which for the sample charger's photos is the catalog less the sample recall's own.
    const reuse = JSON.parse(read("content", "public", "hash-reuse-run.json")) as { falseMatches: { unrelatedRefs: { catalog: number } } };
    const catalog = catalogOfficialHashes();
    const own = catalog.filter((c) => c.recall === "BH-2026-01").length;
    expect(own).toBeGreaterThan(0);
    expect(reuse.falseMatches.unrelatedRefs.catalog).toBe(catalog.length - own);
    expect(doc("results.md")).toContain(`(${int(catalog.length - own)} for the sample charger's photos: the catalog's ${int(catalog.length)} across all recalls, less the sample recall's own ${own})`);
    const research = read("src", "components", "evidence", "Research.tsx");
    expect(research).toContain("in a catalog of ${catalogOfficialHashes().length");
    for (const text of [...ALL, research]) expect(text).not.toMatch(/[\d,]+ (?:distinct )?published pictures of other recalls/);
    // The README's history sentence is the one scripts/facts.ts computed from git.
    expect(facts.history).not.toBeNull();
    expect(README).toContain(facts.history!.sentence);
    // A refund to the original purchase: PayPal marked it COMPLETED at once, and says how long it takes to reach the buyer.
    const t = JSON.parse(read("content", "public", "e2e-transcript.json")) as { suites: Record<string, { ids: Record<string, unknown> }> };
    expect(t.suites["claim-shop"].ids.refund_status).toBe("COMPLETED");
    for (const text of [README, doc("research.md")]) {
      expect(text).toContain("COMPLETED at once");
      expect(text).toContain(PROBLEM.refundTerms.reach);
    }
    const pages = ["src/app/page.tsx", "src/components/evidence/Contrast.tsx", "src/components/evidence/Compare.tsx", "src/components/evidence/Research.tsx", "content/public/measured.json"].map((f) => read(...f.split("/")));
    for (const text of [...ALL, ...pages]) expect(text).not.toMatch(/went through at once|the sandbox did at once/);
    // The CPSC's FY2025 figure is an average correction rate across recalls, never a share of recalled products.
    const home = read("src", "app", "page.tsx");
    expect(home).toContain("its average correction rate across recalls was {PROBLEM.correctionRate.rate}");
    for (const text of [...ALL, home]) expect(text).not.toMatch(/of recalled products were corrected/);
  });

  it("the problem, measured from primary sources: the README and docs/research.md print the figures src/lib/research.ts holds", () => {
    const P = PROBLEM;
    const inReadme = [P.correctionRate.rate, P.correctionRate.target, P.fraudRfi.cite, P.adminComment.oneName, P.truepicComment.claims, P.weeksPortal.wait, P.payoutFee.fee, P.checkCost.cost, P.consumerReports.notHeard];
    const inDocs = [...inReadme, P.adminComment.products, P.paypalPortal.confirm, P.refundTerms.reach, P.ftcChecks.claimsRate, P.ftcChecks.cashedWeighted, P.ftcChecks.cashedMedian, P.digitalSuccess.digital, P.digitalSuccess.checksWithout, P.consumerReports.responded, P.euSurvey.noReaction, P.euSurvey.reimbursed, P.cpscReview.effort];
    for (const fig of inReadme) expect(README, fig).toContain(fig);
    for (const fig of inDocs) expect(doc("research.md"), fig).toContain(fig);
    // The CPSC listing count is the committed count, never typed in.
    const listing = JSON.parse(read("content", "recalls", "listing-mentions.json")) as { records: number; terms: Record<string, { count: number }> };
    expect(P.listing.records).toBe(listing.records);
    expect([P.listing.paypal, P.listing.venmo]).toEqual([listing.terms.paypal.count, listing.terms.venmo.count]);
    for (const text of [README, doc("research.md")].map((x) => x.replace(/\*\*/g, ""))) {
      expect(text).toContain(`${int(P.listing.records)} CPSC recall records since 1973`);
      expect(text).toMatch(new RegExp(`${P.listing.paypal === 1 ? "one" : P.listing.paypal} names PayPal and ${P.listing.venmo === 0 ? "none" : P.listing.venmo} names Venmo`));
    }
    // The FY2025 rate is framed as what it measures, and never set beside the 6 in 100 as the same thing.
    for (const text of [README, doc("research.md")]) expect(text).toMatch(/not comparable/);
    // Each primary-source row in docs/research.md carries its URL.
    for (const row of [P.correctionRate, P.fraudRfi, P.adminComment, P.truepicComment, P.paypalPortal, P.weeksPortal, P.payoutFee, P.payoutTerms, P.refundTerms, P.checkCost, P.ftcChecks, P.digitalSuccess, P.consumerReports, P.euSurvey, P.cpscReview]) expect(doc("research.md"), row.source).toContain(row.url);
    expect(doc("research.md")).toContain(P.listing.url);
  });
});
