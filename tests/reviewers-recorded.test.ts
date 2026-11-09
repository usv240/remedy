import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aloneWouldPay, reviewedRows, reviewerComparison } from "@/components/evidence/reviewer-data";
import { loadFixtureRecalls } from "@/lib/verify/fixtures";
import { referee, type ReviewInput } from "@/lib/verify/reviewers";

/**
 * One reviewer against the referee (src/components/evidence/reviewer-data.ts): the counts match a plain reading of the
 * recorded files, no reviewer vote is invented where a file kept none, and the referee in code pays only when both
 * counted votes say meets.
 */
const ROOT = process.cwd();
const read = <T>(...p: string[]): T => JSON.parse(readFileSync(path.join(ROOT, "content", ...p), "utf8")) as T;
type Row = { config: string; decided_by?: string; referee: string | null; votes?: unknown };

describe("the recorded rows at the claim path's setting", () => {
  const sweep = read<{ cases: Row[] }>("verify", "sweep-results.json").cases.filter((r) => r.config === "opus-medium");
  const sample = read<{ cases: Row[] }>("verify", "sweep-sample.json").cases.filter((r) => r.config === "opus-medium");
  const rows = reviewedRows();

  it("counts every sweep row once, and the rows that reached the reviewers as the files mark them", () => {
    expect(sweep).toHaveLength(24);
    expect(rows.filter((r) => r.source === "sweep")).toHaveLength(24);
    expect(rows.filter((r) => r.source === "sample")).toHaveLength(sample.length);
    const reachedInFiles = [...sweep, ...sample].filter((r) => r.decided_by === "reviewers").length;
    expect(rows.filter((r) => r.source !== "preset" && r.firstPass === "reviewers")).toHaveLength(reachedInFiles);
    // Every row that reached the reviewers carries the referee's decision; no other row does.
    for (const r of rows) expect(r.referee === null, `${r.source} ${r.caseId} ${r.trial}`).toBe(r.firstPass === "checks");
    for (const r of rows.filter((r) => r.firstPass === "reviewers")) expect(["verify", "person"]).toContain(r.referee);
  });

  it("invents no vote: votes are null where the file kept only the referee's decision", () => {
    const sweepVotes = [...sweep, ...sample].filter((r) => Array.isArray(r.votes) && (r.votes as unknown[]).length).length;
    expect(rows.filter((r) => r.source !== "preset" && r.votes)).toHaveLength(sweepVotes);
    const preset = rows.filter((r) => r.source === "preset" && r.firstPass === "reviewers");
    expect(preset.length).toBeGreaterThan(0);
    for (const r of preset) expect(r.votes?.map((v) => v.reviewer).sort()).toEqual(["product", "remedy"]);
  });

  it("tallies the referee over the rows it saw, and each reviewer alone only over rows with recorded votes", () => {
    const c = reviewerComparison();
    expect(c.rows).toHaveLength(rows.length);
    expect(c.settled + c.reached.length).toBe(rows.length);
    expect(c.withVotes).toBe(rows.filter((r) => r.votes).length);
    expect(c.product.rows).toBe(c.withVotes);
    expect(c.remedy.rows).toBe(c.withVotes);
    expect(c.referee.rows).toBe(c.reached.length);
    // The referee as designed paid nothing it should not have on the recorded rows.
    expect(c.referee.wrongPay).toBe(0);
    // Hand count: the rows the reviewers saw with a known money answer that were paid.
    const paidByReferee = c.reached.filter((r) => r.known === "paid" && r.decision === "verified").length;
    expect(c.referee.paid - c.referee.wrongHold).toBe(paidByReferee);
    // Alone: a reviewer pays only on a counted meets.
    for (const r of c.reached.filter((x) => x.votes)) {
      for (const who of ["product", "remedy"] as const) {
        const v = r.votes!.find((x) => x.reviewer === who)!;
        expect(aloneWouldPay(r, who)).toBe(v.answer === "meets" && v.counted);
      }
    }
    expect(typeof c.sameAsReferee).toBe("boolean");
  });
});

describe("the referee in code, on the recorded votes", () => {
  type Rec = { reviews: { decision: string; votes: (ReviewInput & { counted: boolean })[] } | null };
  const rec = read<Rec>("presets", "recorded", "sample-charger-cut.json");
  const ctx = loadFixtureRecalls()["BH-2026-01"];
  const input = (v: ReviewInput) => ({ reviewer: v.reviewer, answer: v.answer, evidence: v.evidence, model_read: v.model_read, marker_text_read: v.marker_text_read, reason_plain: v.reason_plain, reason_technical: v.reason_technical, confidence: v.confidence });

  it("gives the recorded decision again from the recorded votes", () => {
    expect(rec.reviews).not.toBeNull();
    expect(ctx).toBeDefined();
    const r = referee(rec.reviews!.votes.map(input), ctx);
    expect(r.decision).toBe(rec.reviews!.decision);
    expect(r.votes.map((v) => v.counted)).toEqual(rec.reviews!.votes.map((v) => v.counted));
  });

  it("never pays when the two counted votes disagree, or when one is unclear", () => {
    const [p, m] = rec.reviews!.votes.map(input);
    expect(referee([p, { ...m, answer: "does_not_meet" }], ctx).decision).toBe("person");
    expect(referee([{ ...p, answer: "does_not_meet" }, m], ctx).decision).toBe("person");
    expect(referee([p, { ...m, answer: "unclear" }], ctx).decision).toBe("person");
    expect(referee([p, { ...m, confidence: 0.5 }], ctx).decision).toBe("person");
  });
});
