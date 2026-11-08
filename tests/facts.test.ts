import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { errorRates, freeCaught } from "@/components/judges/errors";
import { TOOLS } from "@/lib/mcp/tools";
import { aboutSeconds, RESEARCH } from "@/lib/research";
import { catalogOfficialHashes } from "@/lib/verify/dhash";
import { derived } from "../scripts/facts";

/**
 * One source for each figure the README, TESTING.md and /evidence repeat: content/public/facts.json, written by
 * scripts/facts.ts after the suites run. This test fails when the file disagrees with the code it was counted from, or
 * when the README or TESTING.md print a different figure. After adding tests, run `npx tsx scripts/facts.ts`.
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
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const int = (n: number) => n.toLocaleString("en-US");
const all = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m.slice(1));
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

  it("counts the catalog of distinct published pictures and reads the measured timings", () => {
    expect(facts.catalogPictures).toBe(catalogOfficialHashes().length);
    const items = (JSON.parse(read("content", "public", "measured.json")) as { items: { id: string; figure: string }[] }).items;
    expect(facts.measured).toEqual({ checkSeconds: aboutSeconds(items.find((i) => i.id === "live-check")?.figure), payoutSeconds: aboutSeconds(items.find((i) => i.id === "payout")?.figure) });
  });

  it("holds the accessibility suite's last run, every page it covers at four views each, all passing", () => {
    const routes = /const routes = \[([^\]]+)\]/.exec(read("tests", "e2e", "pages-a11y.mjs"))?.[1].split(",").length ?? 0;
    expect(facts.a11y).not.toBeNull();
    expect(facts.a11y!.pages).toBe(routes);
    expect(facts.a11y!.views).toBe(routes * 4);
    expect(facts.a11y!.passed).toBe(facts.a11y!.views);
  });
});

describe("the README and TESTING.md print the same figures", () => {
  it("unit tests", () => {
    if (COUNTING) return;
    for (const doc of [README, TESTING]) {
      const found = all(doc, /(\d[\d,]*) passed, (\d[\d,]*) skipped/g);
      expect(found.length).toBeGreaterThan(0);
      for (const [p, s] of found) expect([p, s]).toEqual([int(facts.unitTests.passed), int(facts.unitTests.skipped)]);
    }
  });

  it("accessibility page views and pages", () => {
    const a = facts.a11y!;
    for (const doc of [README, TESTING]) {
      for (const [n, of] of all(doc, /(\d+) of (\d+) page views/g)) expect([n, of]).toEqual([String(a.passed), String(a.views)]);
      for (const [n] of all(doc, /All (\d+) page views/g)) expect(n).toBe(String(a.views));
      for (const [n] of all(doc, /(\d+) pages(?: at|,) phone and desktop/g)) expect(n).toBe(String(a.pages));
    }
    expect(README).toContain(`${a.passed} of ${a.views} page views`);
  });

  it("MCP tools", () => {
    const word = WORDS[facts.mcp.tools];
    for (const [w] of all(README, /with (\w+) tools:/g)) expect(w).toBe(word);
    expect(README).toContain(`with ${word} tools:`);
    for (const name of facts.mcp.names) {
      expect(README).toContain(`\`${name}\``);
      expect(TESTING).toContain(`\`${name}\``);
    }
    const info = JSON.parse(read("content", "info.json")) as Record<string, { technical?: string }>;
    for (const name of facts.mcp.names) expect(info["dev.mcp"].technical).toContain(name);
  });

  it("the photo checks, the error rates and the catalog", () => {
    const f = facts.photoChecks;
    expect(README).toContain(`**${f.freeCaught} of ${f.freeTotal}** stopped by code alone`);
    const e = facts.errors;
    expect(README).toContain(`**paid when it should not have been: ${e.wrongPay.count} of ${e.wrongPay.of}** decisions, on ${e.wrongPay.photos} photos`);
    expect(README).toContain(`**held for a person or a new photo when it could have been paid: ${e.heldBack.count} of ${e.heldBack.of}**`);
    for (const [n, of] of all(README, /(\d+) of (\d+) paid wrongly/g)) expect([n, of]).toEqual([String(e.wrongPay.count), String(e.wrongPay.of)]);
    for (const [n] of all(README, /the ([\d,]+) distinct published pictures/g)) expect(n).toBe(int(facts.catalogPictures));
    expect(README).toContain(`the ${int(facts.catalogPictures)} distinct published pictures`);
  });

  it("the free answers' times, from the recorded runs, and no figure they do not support", () => {
    const d = derived();
    expect(facts.timings).toEqual(d.timings);
    const t = d.timings;
    expect(README).toContain(`Each answered in ${t.free.min} to ${t.free.max} ms (median ${t.free.median} ms)`);
    expect(README).toContain(`the hash comparison itself took ${t.match.min} to ${t.match.max} ms`);
    expect(README).toContain(`a median of ${t.official.median} ms`);
    expect(README).toContain(`${t.official.min} to ${t.official.max} ms`);
    for (const doc of [README, TESTING, read("content", "info.json")]) {
      expect(doc).not.toMatch(/about 60 ms|under 100 ms/);
    }
  });

  it("the reading accuracy, the model settings, the photo count and the money headline", () => {
    const d = derived();
    expect(facts.reading).toEqual(d.reading);
    expect(facts.settings).toEqual(d.settings);
    expect(facts.multiPhoto).toEqual(d.multiPhoto);
    expect(facts.value).toEqual(d.value);
    const r = d.reading;
    expect(README).toContain(`**Reading accuracy on real CPSC recalls: ${r.right} of ${r.readings} readings right.**`);
    expect(README).toContain(`right product ${r.product} of ${r.trials}, made safe ${r.madeSafe} of ${r.trials}`);
    const claim = d.settings.find((s) => s.id === "opus-medium")!;
    expect(README).toContain(`right on ${claim.correct.replace(" of ", " of ")}`);
    expect(README).toContain(`(${claim.wrongPay} each)`);
    expect(README).toContain(`${d.multiPhoto.count} of the ${d.multiPhoto.of} ask for more than one photo`);
    expect(README).toContain(`cover **${d.value.total}**`);
    expect(README).toContain(`**${d.value.unclaimed}** of those products stays in homes unclaimed`);
    expect(README).toContain(`is worth **${d.value.perPoint}** to their owners in refunds or replacements`);
    expect(README).toContain(`(${d.value.covered} of ${d.value.recalls} state units and a price)`);
  });

  it("the research and the measured timings", () => {
    for (const fig of [RESEARCH.fullRemedy.lift, `${RESEARCH.simpler.from} to ${RESEARCH.simpler.to}`, RESEARCH.simpler.named, RESEARCH.comeBack.share]) expect(README).toContain(fig);
    expect(README).toContain(`about ${facts.measured.checkSeconds} seconds`);
    expect(README).toContain(`about ${facts.measured.payoutSeconds}`);
  });
});
