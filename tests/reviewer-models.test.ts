import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewerModels, modelName, reviewerModelsSection } from "@/components/evidence/ReviewerModels";
import { compareReviewerModels, REVIEWER_MODELS_FILE } from "@/components/evidence/reviewer-models";
import { MODEL } from "@/lib/ai/claude";
import info from "../content/info.json";

/**
 * The two reviewers on one model and on two (/evidence/photo-checks#reviewer-models): every figure in the table and every
 * sentence around it comes from content/verify/reviewer-models.json. The file is read again here and counted by hand,
 * not through the reader, and the rendered section, the Info entry and docs/results.md and docs/research.md are held to
 * that count. No model call.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
type Vote = { reviewer: "product" | "remedy"; model: string; answer: string; replayed?: boolean };
type Row = { config: string; trial: number; case: string; known: string; decision: string; votes: Vote[] | null; usd: number; vision_replayed?: boolean };
type File = {
  trials: number;
  configs: { id: string; note: string; env: Record<string, string> }[];
  cases: Row[];
  comparison: unknown;
  aiUsage: { usd: number; calls: number } | null;
  spentUsd: number;
};
const raw = JSON.parse(read(REVIEWER_MODELS_FILE)) as File;

const voted = (r: Row) => r.votes?.length === 2;
const vote = (r: Row, who: Vote["reviewer"]) => r.votes?.find((v) => v.reviewer === who);
const of = (n: number, d: number) => `${n} of ${d}`;

/** The four table figures for one run, counted straight from the rows. */
function hand(id: string) {
  const mine = raw.cases.filter((r) => r.config === id);
  const reviewed = mine.filter(voted);
  const notPaid = mine.filter((r) => r.known === "not_paid");
  const paid = mine.filter((r) => r.known === "paid");
  return {
    same: of(reviewed.filter((r) => vote(r, "product")!.answer === vote(r, "remedy")!.answer).length, reviewed.length),
    wrongPay: of(notPaid.filter((r) => r.decision === "verified").length, notPaid.length),
    wrongHold: of(paid.filter((r) => r.decision !== "verified").length, paid.length),
    usdPerClaim: `$${(mine.reduce((s, r) => s + r.usd, 0) / mine.length).toFixed(4)}`,
    reviewed: reviewed.length,
    unfinished: mine.filter((r) => r.decision === "firm_review" && !voted(r)).length,
  };
}

/** The visible text of rendered markup, with React's escapes undone. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const s = reviewerModelsSection()!;
const A = hand("A");
const B = hand("B");
const cases = [...new Set(raw.cases.map((r) => r.case))];

describe("the reviewer-models file", () => {
  it("holds two runs of the same photos and trials, and its comparison is the count of its rows", () => {
    expect(raw.configs.map((c) => c.id)).toEqual(["A", "B"]);
    for (const id of ["A", "B"]) {
      const mine = raw.cases.filter((r) => r.config === id);
      expect(mine).toHaveLength(cases.length * raw.trials);
      expect(new Set(mine.map((r) => `${r.case}|${r.trial}`)).size).toBe(mine.length);
    }
    const notes = Object.fromEntries(raw.configs.map((c) => [c.id, c.note]));
    expect(compareReviewerModels(raw.cases as never, notes)).toEqual(raw.comparison);
    expect(s.comparison).toEqual(raw.comparison);
  });

  it("changes only the Remedy reviewer's model between the runs, and keeps the default on the code's model", () => {
    const [a, b] = raw.configs;
    expect(a.env).toEqual({});
    expect(Object.keys(b.env)).toEqual(["REMEDY_REVIEWER_MODEL_REMEDY"]);
    for (const r of raw.cases.filter((x) => x.config === "A" && voted(x))) for (const v of r.votes!) expect(v.model, `${r.case} ${r.trial}`).toBe(MODEL);
    for (const r of raw.cases.filter((x) => x.config === "B" && voted(x))) {
      expect(vote(r, "product")!.model).toBe(MODEL);
      expect(vote(r, "remedy")!.model).toBe(b.env.REMEDY_REVIEWER_MODEL_REMEDY);
      // The photo check and the Product vote were re-read from the first run, so only the Remedy reviewer differs.
      expect(r.vision_replayed, `${r.case} ${r.trial}`).toBe(true);
      expect(vote(r, "product")!.replayed, `${r.case} ${r.trial}`).toBe(true);
      const first = raw.cases.find((x) => x.config === "A" && x.case === r.case && x.trial === r.trial)!;
      if (voted(first)) expect(vote(r, "product")!.answer).toBe(vote(first, "product")!.answer);
    }
  });
});

describe("the section's figures and sentences", () => {
  it("the table is a hand count of the file", () => {
    expect(s.runs.map(({ same, wrongPay, wrongHold, usdPerClaim }) => ({ same, wrongPay, wrongHold, usdPerClaim }))).toEqual(
      [A, B].map(({ same, wrongPay, wrongHold, usdPerClaim }) => ({ same, wrongPay, wrongHold, usdPerClaim })),
    );
    expect(s.runs.map((r) => r.label)).toEqual([`Both on ${modelName(MODEL).replace("Claude ", "")}`, `Remedy reviewer on ${modelName(raw.configs[1].env.REMEDY_REVIEWER_MODEL_REMEDY).replace("Claude ", "")}`]);
    expect(s.runs.map((r) => r.isDefault)).toEqual([true, false]);
  });

  it("says what the rows show: no safer, the photo that should be paid held every time, and so the default stays", () => {
    const paid = raw.cases.filter((r) => r.known === "paid");
    const heldB = paid.filter((r) => r.config === "B" && r.decision !== "verified");
    const nB = paid.filter((r) => r.config === "B").length;
    expect(A.wrongPay.startsWith("0 of") && B.wrongPay.startsWith("0 of")).toBe(true);
    expect(heldB).toHaveLength(nB);
    expect(s.shows).toContain(`neither run paid a photo it should not have (${A.wrongPay} and ${B.wrongPay})`);
    expect(s.shows).toContain(`went to a person in every trial (${of(nB, nB)})`);
    expect(s.shows).toContain(`so both reviewers stay on ${modelName(MODEL)}`);
    // On the default model, the first run's one hold of that photo had no reviewer votes: they did not finish.
    const heldA = paid.filter((r) => r.config === "A" && r.decision !== "verified");
    expect(heldA.every((r) => !voted(r) && r.decision === "firm_review")).toBe(true);
    expect(s.heldWhy).toContain(`held ${heldA.length === 1 ? "once" : `${heldA.length} times`} (${A.wrongHold}), in`);
    expect(s.denominators).toContain(`did not finish on ${A.unfinished} claims in the first run and on ${B.unfinished || "none"} in the second`);
    expect(s.denominators).toContain(`the first run has ${A.reviewed} reviewed claims and the second ${B.reviewed}`);
  });

  it("puts the two reviewers' independence on their rulebooks, from where they disagreed in the first run", () => {
    const firstVoted = raw.cases.filter((r) => r.config === "A" && voted(r));
    const differ = firstVoted.filter((r) => vote(r, "product")!.answer !== vote(r, "remedy")!.answer);
    const same = firstVoted.filter((r) => vote(r, "product")!.answer === vote(r, "remedy")!.answer);
    // Every disagreement was on a hair dryer photo, and every agreement on the charger.
    expect(new Set(differ.map((r) => r.case))).toEqual(new Set(["look-alike-hair-dryer", "made-safe-hair-dryer-cord-cut"]));
    expect(new Set(same.map((r) => r.case))).toEqual(new Set(["sample-charger-cut"]));
    expect(s.independence).toContain("comes from the different rulebook each reads");
    expect(s.independence).toContain(`different answers on the look-alike hair dryer and the CPSC's hair dryer photo in all ${differ.length} claims they reviewed`);
    expect(s.independence).toContain(`the same answer on the sample charger in all ${same.length}`);
  });

  it("says the sample is small, and what the run cost, from the file", () => {
    expect(s.small).toContain(`The sample is small, ${cases.length} photos and ${raw.trials} trials (${cases.length * raw.trials} claims a run)`);
    expect(raw.aiUsage).not.toBeNull();
    expect(s.spend).toContain(`$${raw.aiUsage!.usd.toFixed(2)} over ${raw.aiUsage!.calls} calls`);
    expect(s.spend).toContain(`$${raw.spentUsd.toFixed(2)} by the sweep's own count`);
    expect(s.intro).toContain(`the Remedy reviewer on ${modelName(raw.configs[1].env.REMEDY_REVIEWER_MODEL_REMEDY)} (REMEDY_REVIEWER_MODEL_REMEDY)`);
    expect(s.photos).toContain(`Both runs read the ${cases.length} photos that reach the two reviewers, ${raw.trials} trials each`);
  });

  it("renders those figures and sentences", () => {
    const html = renderToStaticMarkup(createElement(ReviewerModels));
    const text = textOf(html);
    for (const t of [s.intro, s.photos, s.shows, s.independence, s.small, s.heldWhy, s.denominators, s.spend]) expect(text).toContain(t);
    // Each body row of the table: the measure, then run A's figure, then run B's.
    const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    const cells = [...body.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map((c) => textOf(c[1]).trim()));
    expect(cells).toEqual([
      ["Same answer from both reviewers", A.same, B.same],
      ["Paid when it should not have been", A.wrongPay, B.wrongPay],
      ["Held when it could have been paid", A.wrongHold, B.wrongHold],
      ["Cost per claim, list price", A.usdPerClaim, B.usdPerClaim],
    ]);
    expect(html).toContain("(the default)");
  });

  it("writes plain copy", () => {
    const entry = (info as Record<string, { title: string; what: string; why: string; technical?: string }>)["evidence.models"];
    for (const t of [s.intro, s.photos, s.figures, s.shows, s.independence, s.small, s.heldWhy, s.denominators, s.spend, JSON.stringify(entry)]) {
      expect(t).not.toMatch(/[–—]|\p{Extended_Pictographic}/u);
      expect(t).not.toMatch(/hackathon|judg(e|ing)\b|fraud|fake|scam/i);
    }
  });
});

describe("where the section appears", () => {
  it("sits on /evidence/photo-checks right after where the two-reviewer design comes from, with its Info entry", () => {
    const page = read("src", "app", "evidence", "photo-checks", "page.tsx");
    expect(page).toMatch(/<Lineage \/>\s*<\/section>\s*\{reviewerModels\(\) \? \(\s*<section id="reviewer-models"/);
    expect(page).toContain('<Info id="evidence.models"');
    const entry = (info as Record<string, { technical?: string }>)["evidence.models"];
    expect(entry.technical).toContain(`${cases.length} photos, ${raw.trials} trials each`);
    expect(entry.technical).toContain(REVIEWER_MODELS_FILE.replace(/\\/g, "/"));
  });

  it("docs/results.md and docs/research.md say the same, from the same sentences", () => {
    const plain = (doc: string) => doc.replace(/`/g, "");
    const results = plain(read("docs", "results.md"));
    for (const t of [s.intro, s.figures, s.shows, s.independence]) expect(results).toContain(t);
    expect(results).toContain(s.small.replace(/\.$/, ""));
    const research = plain(read("docs", "research.md"));
    const at = research.indexOf("running one reviewer on a second model is a configuration change");
    expect(at).toBeGreaterThan(-1);
    const after = research.slice(at, research.indexOf("\n", at));
    expect(after).toContain(s.shows);
    expect(after).toContain("/evidence/photo-checks#reviewer-models");
    expect(after).toContain("content/verify/reviewer-models.json");
  });
});
