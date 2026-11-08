import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { answerChanges, checkTimes, errorRates, freeCaught, hashSpeed, sweepSettings } from "@/components/judges/errors";
import { hostedDailyUsd } from "@/lib/ai/hosted-budget";
import { TOOLS } from "@/lib/mcp/tools";
import { aboutSeconds, RESEARCH } from "@/lib/research";
import { catalogOfficialHashes } from "@/lib/verify/dhash";
import { derived } from "../scripts/facts";

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
  unitTests: { passed: number; skipped: number; failed: number };
  a11y: { pages: number; views: number; passed: number } | null;
  mcp: { tools: number; names: string[] };
  photoChecks: { freeCaught: number; freeTotal: number };
  errors: { wrongPay: { count: number; of: number; photos: number }; heldBack: { count: number; of: number; photos: number } };
  catalogPictures: number;
  measured: { checkSeconds: number | null; payoutSeconds: number | null };
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

  it("counts the catalog of distinct published pictures, the photo check time from the recorded live calls, and the payout from measured.json", () => {
    expect(facts.catalogPictures).toBe(catalogOfficialHashes().length);
    const items = (JSON.parse(read("content", "public", "measured.json")) as { items: { id: string; figure: string }[] }).items;
    expect(facts.measured).toEqual({ checkSeconds: checkTimes().about, payoutSeconds: aboutSeconds(items.find((i) => i.id === "payout")?.figure) });
    // One source for how long a check takes: the recorded live calls, never a typed-in figure.
    expect(items.some((i) => i.id === "live-check")).toBe(false);
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
      for (const [n] of all(text, /the ([\d,]+) distinct published pictures/g)) expect(n).toBe(int(facts.catalogPictures));
      for (const [n] of all(text, /against the ([\d,]+) distinct published pictures/g)) expect(n).toBe(int(facts.catalogPictures));
    }
    expect(README).toContain(`the ${int(facts.catalogPictures)} distinct published pictures`);
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
    let seen = 0;
    for (const text of ALL) {
      for (const [n] of [...all(text, /\$(\d+(?:\.\d+)?) of Claude a day/g), ...all(text, /\$(\d+(?:\.\d+)?) a day on the hosted site/g)]) {
        expect(Number(n)).toBe(usd);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("the model settings, scored as they stood the day of the sweep first, then re-scored beside the dated revisions", () => {
    const d = derived();
    expect(facts.settings).toEqual(d.settings);
    expect(facts.answerChanges).toEqual(d.answerChanges);
    const claim = d.settings.find((s) => s.id === "opus-medium")!;
    const low = d.settings.find((s) => s.id === "opus-low")!;
    const sonnet = d.settings.find((s) => s.id === "sonnet-default")!;
    expect(README).toContain(`was right on **${claim.atSweep}** against the known answers on the day the sweep ran, and **${claim.correct}** re-scored after ${WORDS[d.answerChanges.count]} answers were revised`);
    expect(README).toContain("content/verify/answer-changes.json");
    const r = doc("results.md");
    expect(r).toContain(`the claim path's setting was right on **${claim.atSweep}** (Opus at low effort ${low.atSweep}, Sonnet 5.5 ${sonnet.atSweep})`);
    expect(r).toContain(`Re-scored with today's answers: ${claim.correct}, Opus at low effort and Sonnet 5.5 ${low.correct}`);
    expect(low.correct).toBe(sonnet.correct);
    expect(r).toContain(`(${claim.wrongPay} each)`);
    expect(r).toContain(`$${low.usdPerCase} a check against $${claim.usdPerCase}`);
    const e = facts.errors.heldBack;
    expect(r).toContain(`the sample charger, paid in ${e.of - e.count} of ${e.of}`);
    // Day-of-sweep first: in each document, the day-of-sweep score is printed before the re-scored one.
    for (const text of [README, r]) expect(text.indexOf(claim.atSweep)).toBeLessThan(text.indexOf(claim.correct));
  });

  it("the sample recall's reference pictures, before and after", () => {
    const d = derived();
    expect(facts.references).toEqual(d.references);
    const ref = d.references;
    expect(README).toContain(`went from ${range(ref.before)} to ${range(ref.after)}`);
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
    for (const text of [README, doc("results.md")]) expect(text).toContain(`**Reading accuracy on real CPSC recalls: ${r.right} of ${r.readings} readings right`);
    for (const text of [README, doc("results.md")]) expect(text).toContain(`right product ${r.product} of ${r.trials}, made safe ${r.madeSafe} of ${r.trials}`);
    expect(doc("results.md")).toContain(`${d.multiPhoto.count} of the ${d.multiPhoto.of} ask for more than one photo`);
    expect(README).toContain(`cover **${d.value.total}**`);
    expect(README).toContain(`**${d.value.unclaimed}** of those products stays in homes unclaimed`);
    expect(README).toContain(`is worth **${d.value.perPoint}** to their owners in refunds or replacements`);
    expect(README).toContain(`(${d.value.covered} of ${d.value.recalls} state units and a price)`);
  });

  it("the research and the payout timing", () => {
    for (const fig of [RESEARCH.fullRemedy.lift, `${RESEARCH.simpler.from} to ${RESEARCH.simpler.to}`, RESEARCH.simpler.named, RESEARCH.comeBack.share]) expect(README).toContain(fig);
    const research = doc("research.md");
    for (const fig of [RESEARCH.directNotice.direct, RESEARCH.directNotice.press, RESEARCH.euStudy.direct, RESEARCH.euStudy.generic, RESEARCH.fullRemedy.lift]) expect(research).toContain(fig);
    expect(README).toContain(`the PayPal payout in **about ${facts.measured.payoutSeconds}**`);
  });

  it("the README stays short: its top screen and the three ideas, with the long sections in docs/*.md", () => {
    const words = README.split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThan(2000);
    for (const heading of ["## The problem, and the result", "## Three ideas at its heart", "## Results", "## Read more"]) expect(README).toContain(heading);
    for (const name of Object.keys(DOCS)) expect(README).toContain(`docs/${name}`);
  });
});
