import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkTimes, checkTimeWords } from "@/components/evidence/errors";

/**
 * One start path: the README's 30-second path, TESTING.md's "Start here", the home page's primary action and the first
 * stop of /evidence's longer path all name the same first step, Try a photo (/try). The home page's first screen keeps
 * one proof line; how long a check takes is said the way the recorded runs say it, from one function.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const README = read("README.md");
const HOME = read("src", "app", "page.tsx");

describe("one start path", () => {
  it("the README, TESTING.md, the home page and /evidence name the same first step", () => {
    const thirty = README.split("\n").find((l) => l.startsWith("- **In 30 seconds:**")) ?? "";
    expect(thirty).toContain("press **Try a photo** on the [home page]");
    expect(thirty).toContain("**Run it** on the first photo");
    expect(read("TESTING.md").split("\n").find((l) => l.startsWith("- **Start here:**"))).toContain("press **Try a photo** on the [home page]");
    // The hero's one action is Try a photo, to /try; the tour is a text link, never a second primary button.
    const hero = HOME.slice(HOME.indexOf('<section className="hero frame"'), HOME.indexOf('<section id="intro"'));
    expect(hero).toMatch(/<Link href="\/try" className="btn btn-primary hero-cta">\s*Try a photo\s*<\/Link>/);
    expect(hero.match(/btn-primary/g)?.length).toBe(1);
    expect(HOME).not.toMatch(/<TourButton className="btn/);
    const evidence = read("src", "app", "evidence", "page.tsx");
    expect(evidence.slice(evidence.indexOf("const PATH = ["))).toMatch(/^const PATH = \[\s*\{ href: "\/try"/);
  });

  it("the hero keeps one proof line, with one figure", () => {
    const hero = HOME.slice(HOME.indexOf('<p className="hero-result">'), HOME.indexOf("</p>", HOME.indexOf('<p className="hero-result">')));
    expect(hero.match(/\{proof\.\w+\}/g)).toEqual(["{proof.wrongPay}"]);
    expect(hero).not.toMatch(/seconds|checkTime/);
  });

  it("how long a check takes, as the data says it: about 11 s, more when the two reviewers look, from checkTimes()", () => {
    const ct = checkTimes();
    const w = checkTimeWords();
    expect(w.short).toBe(`about ${ct.about} s; about ${ct.aboutWithReviewers} s when the two reviewers look`);
    expect(ct.aboutWithReviewers).toBe(Math.round(ct.withReviewers.median));
    expect(ct.withReviewers.n).toBe(ct.reviewers.n);
    // The flagship card says its own run's times and then the same sentence.
    const f = checkTimeWords(19_522).flagship!;
    expect(f).toContain(`the photo check ${(ct.flagship!.checkMs / 1000).toFixed(1)} s and the two reviewers ${(ct.flagship!.reviewersMs / 1000).toFixed(1)} s`);
    expect(f).toContain(w.short);
    expect(HOME).toContain("A check takes {times.short}.");
    expect(HOME).toContain("checkTimeWords(t.total_ms).flagship");
    expect(README).toContain(`the photo check in **about ${ct.about} seconds** (about ${ct.aboutWithReviewers} when the two reviewers look)`);
  });
});
