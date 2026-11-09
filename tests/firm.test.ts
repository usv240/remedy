import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { csvTemplate, noticeText, parseSales, publicLine } from "@/lib/firm/buyers";
import { checksLine, checkWords, confidence, passCount, REVIEWERS_LABEL, reviewersOutcome, shownCheck } from "@/lib/firm/checks";
import { sampleChecks, sampleDebate, sampleResult, SAMPLE_PLAN } from "@/lib/firm/sample-claims";
import { addMonths, daysBetween, nextReportDue, reportMonths, reportPeriod, whenWords } from "@/lib/firm/dates";
import { fingerprint, narrativeProblems, promptFigures } from "@/lib/firm/narrative";
import { basePlan, groupFor, MOVABLE, taskFor, toGantt, type PlanRow } from "@/lib/firm/plan";
import { payFromDb, retakeMessage, stageOf } from "@/lib/firm/queue";
import { buildReport, completion, formRows, reportCsv, strayFigures, templateNarrative, type ReportCounts } from "@/lib/firm/report";
import { FIRM_INFO } from "@/lib/firm/info";
import { kpiReconcile } from "@/lib/firm/kpis";

const NOW = new Date("2026-11-05T20:00:00Z");

describe("report periods (CPSC form: due by the first of each month)", () => {
  it("report 1 runs from the announcement to the end of that month", () => {
    const p = reportPeriod("2026-10", "2026-10-29", NOW)!;
    expect(p).toMatchObject({ index: 1, start: "2026-10-29", end: "2026-10-31", dueOn: "2026-11-01", inProgress: false, through: "2026-10-31" });
    expect(p.fromInclusive.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(p.untilExclusive.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
  it("the current month counts through today", () => {
    const p = reportPeriod("2026-11", "2026-10-29", NOW)!;
    expect(p).toMatchObject({ index: 2, start: "2026-11-01", end: "2026-11-30", dueOn: "2026-12-01", inProgress: true, through: "2026-11-05" });
    expect(p.untilExclusive.toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });
  it("nothing before the announcement, and bad months are refused", () => {
    expect(reportPeriod("2026-09", "2026-10-29", NOW)).toBeNull();
    expect(reportPeriod("2026-13", "2026-10-29", NOW)).toBeNull();
    expect(reportPeriod("nov", "2026-10-29", NOW)).toBeNull();
  });
  it("the next report due, and months across a year end", () => {
    expect(nextReportDue("2026-10-29", NOW)).toMatchObject({ month: "2026-11", dueOn: "2026-12-01", index: 2 });
    expect(reportMonths("2026-11-20", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(reportPeriod("2027-01", "2026-11-20", NOW)).toMatchObject({ index: 3, dueOn: "2027-02-01" });
  });
  it("days and recency in words", () => {
    expect(daysBetween("2026-10-29", NOW)).toBe(7);
    expect(whenWords("2026-11-05T01:00:00Z", NOW)).toBe("Today");
    expect(whenWords("2026-11-04T23:00:00Z", NOW)).toBe("Yesterday");
    expect(whenWords("2026-11-02T10:00:00Z", NOW)).toBe("3 days ago");
  });
});

describe("checks as the grid shows them", () => {
  const checks = {
    C1: { status: "pass", score: 0.91 },
    C2: { status: "unclear", score: 0.55 },
    C3: { status: "pass" },
    C4: { status: "fail" },
    C5: { status: "pass" },
  } as never;
  it("one word per check, none where unchecked", () => {
    expect(checkWords(checks)).toEqual({ C1: "pass", C2: "unclear", C3: "pass", C4: "fail", C5: "pass", C6: "none" });
    expect(checkWords(null).C1).toBe("none");
    expect(passCount(checkWords(checks))).toBe(3);
  });
  it("confidence is the lower of the product and made-safe scores", () => {
    expect(confidence(checks)).toBe(0.55);
    expect(confidence({ C3: { status: "fail" } } as never)).toBeNull();
  });
  it("the reviewers column says what the two reviewers did, from the stored debate and who decided", () => {
    expect(reviewersOutcome({ decision: "verified", decidedBy: "reviewers", refereeDecision: "verify", refereeAgreed: true })).toBe("agreed");
    // Verified by the reviewers implies they agreed (decide() verifies over soft items only then), even with no votes kept.
    expect(reviewersOutcome({ decision: "verified", decidedBy: "reviewers", refereeDecision: null, refereeAgreed: null })).toBe("agreed");
    expect(reviewersOutcome({ decision: "firm_review", decidedBy: "reviewers", refereeDecision: "person", refereeAgreed: false })).toBe("disagreed");
    expect(reviewersOutcome({ decision: "firm_review", decidedBy: "reviewers", refereeDecision: "person", refereeAgreed: true })).toBe("agreed_not");
    expect(reviewersOutcome({ decision: "firm_review", decidedBy: "reviewers", refereeDecision: null, refereeAgreed: null })).toBe("not_settled");
    expect(reviewersOutcome({ decision: "verified", decidedBy: "checks", refereeDecision: null, refereeAgreed: null })).toBe("not_needed");
    expect(reviewersOutcome({ decision: "retake", decidedBy: "made_safe", refereeDecision: null, refereeAgreed: null })).toBe("not_needed");
  });
  it("every sample claim's reviewers cell follows from its recorded run: 0.80 agreed and verified, 0.82 not settled", () => {
    const seen = new Set<string>();
    for (const p of SAMPLE_PLAN) {
      p.at.forEach((_, i) => {
        const result = sampleResult(p.kind, i) as { decided_by: string };
        const debate = sampleDebate(p.kind, i) as { referee?: { decision: string; agreed: boolean } } | null;
        const decision = p.kind === "paid" || p.kind === "unclaimed" ? "verified" : p.kind === "retake" ? "retake" : "firm_review";
        const word = reviewersOutcome({ decision, decidedBy: result.decided_by, refereeDecision: debate?.referee?.decision ?? null, refereeAgreed: debate?.referee?.agreed ?? null });
        if (decision === "verified") expect(word).toBe("agreed");
        if (decision === "retake") expect(word).toBe("not_needed");
        seen.add(REVIEWERS_LABEL[word]);
      });
    }
    expect([...seen].sort()).toEqual(["Agreed", "Not needed", "Not settled"]);
  });
  it("an unsure Right product check that the two reviewers settled reads as confirmed by them, never Unsure", () => {
    expect(shownCheck("C1", "unclear", "agreed")).toEqual({ word: "Confirmed by reviewers", tone: "positive", settled: true });
    // Only the reviewers' recorded agreement settles it; held, disagreed or never reviewed stays Unsure.
    for (const r of ["not_settled", "disagreed", "agreed_not", "not_needed"] as const) expect(shownCheck("C1", "unclear", r)).toEqual({ word: "Unsure", tone: "info", settled: false });
    expect(shownCheck("C2", "unclear", "agreed").settled).toBe(false);
    expect(shownCheck("C1", "pass", "agreed")).toEqual({ word: "Pass", tone: "positive", settled: false });
    const words = checkWords({ C1: { status: "unclear" }, C2: { status: "pass" }, C3: { status: "pass" }, C4: { status: "pass" }, C5: { status: "pass" }, C6: { status: "pass" } } as never);
    expect(checksLine(words, "agreed")).toBe("5 of 6 checks pass, C1 confirmed by reviewers");
    expect(checksLine(words, "not_settled")).toBe("5 of 6 checks pass");
    // Every sample claim, from its recorded run: a verified or paid claim with an unsure C1 shows it confirmed; a held one does not.
    let confirmed = 0;
    for (const p of SAMPLE_PLAN) {
      p.at.forEach((_, i) => {
        const w = checkWords(sampleChecks(p.kind, i) as never);
        const result = sampleResult(p.kind, i) as { decided_by: string };
        const debate = sampleDebate(p.kind, i) as { referee?: { decision: string; agreed: boolean } } | null;
        const decision = p.kind === "paid" || p.kind === "unclaimed" ? "verified" : p.kind === "retake" ? "retake" : "firm_review";
        const reviewers = reviewersOutcome({ decision, decidedBy: result.decided_by, refereeDecision: debate?.referee?.decision ?? null, refereeAgreed: debate?.referee?.agreed ?? null });
        const c1 = shownCheck("C1", w.C1, reviewers);
        if (decision === "verified" && w.C1 === "unclear") {
          expect(c1.word).toBe("Confirmed by reviewers");
          confirmed++;
        }
        if (decision !== "verified") expect(c1.word).not.toBe("Confirmed by reviewers");
      });
    }
    expect(confirmed).toBeGreaterThan(0);
  });
  it("the grid, the phone card and the drawer all read the check through shownCheck", () => {
    const src = (f: string) => readFileSync(path.join(process.cwd(), "src", "components", "firm", f), "utf8");
    expect(src("ClaimsGrid.tsx")).toContain("shownCheck(id, p.data!.checks[id], p.data!.reviewers)");
    expect(src("ClaimDrawer.tsx")).toContain("shownCheck(c.id, c.status, r.reviewers)");
    expect(src("ClaimsQueue.tsx")).toContain("checksLine(r.checks, r.reviewers)");
    for (const f of ["ClaimsGrid.tsx", "ClaimDrawer.tsx"]) expect(src(f)).not.toMatch(/WORD\[/);
  });
});

describe("where a claim stands", () => {
  const base = { decision: "verified" as const, reviewOutcome: null, pay: null, hasAmount: true, hasPayee: true };
  it("the payment is the truth once there is one", () => {
    expect(stageOf({ ...base, pay: "paid" })).toBe("paid");
    expect(stageOf({ ...base, pay: "sending" })).toBe("sending");
    expect(stageOf({ ...base, pay: "unclaimed" })).toBe("unclaimed");
    expect(stageOf({ ...base, pay: "returned" })).toBe("unclaimed");
    expect(stageOf({ ...base, pay: "failed" })).toBe("needs_review");
  });
  it("review before payment", () => {
    expect(stageOf(base)).toBe("ready");
    expect(stageOf({ ...base, decision: "firm_review" })).toBe("needs_review");
    expect(stageOf({ ...base, decision: "firm_review", reviewOutcome: "approved" })).toBe("ready");
    expect(stageOf({ ...base, decision: "retake" })).toBe("retake");
    expect(stageOf({ ...base, reviewOutcome: "retake" })).toBe("retake");
    expect(stageOf({ ...base, hasPayee: false })).toBe("needs_review");
  });
  it("Postgres payment words map to the engine's", () => {
    expect(payFromDb("pending", "payout")).toBe("sending");
    expect(payFromDb("success", "payout")).toBe("paid");
    expect(payFromDb("refunded", "refund")).toBe("paid");
    expect(payFromDb("refunded", "payout")).toBe("reversed");
    expect(payFromDb("unclaimed", "payout")).toBe("unclaimed");
  });
  it("the retake message is friendly and plain", () => {
    const m = retakeMessage({ firmName: "Brightline Home", product: "power bank", steps: ["Write recalled on it."], note: "Please show the label." });
    expect(m).toContain("Could you take one more?");
    expect(m).toContain("Please show the label.");
    expect(m).not.toMatch(/—|fraud|fake/i);
  });
});

const counts: ReportCounts = {
  claimsReceived: 34,
  claimsReceivedSample: 30,
  correctionsThisPeriod: 25,
  correctionsCumulative: 33,
  claimsVerified: 23,
  claimsInReview: 5,
  retakesAsked: 4,
  refundsPaidCount: 19,
  refundsPaidCents: 1900,
  replacementsCount: 0,
  replacementsCents: 0,
  unclaimedCount: 3,
  unclaimedCents: 300,
  notifiedEmail: 0,
  notifiedSms: 0,
  notifiedMail: 0,
  contactedEmail: 3,
  contactedOnline: 31,
};
const report = () =>
  buildReport({
    counts,
    period: reportPeriod("2026-11", "2026-10-29", NOW)!,
    firm: { name: "Brightline Home", isSample: true },
    recall: { number: "27056", title: "HAIARA Power Banks Recalled", short: "HAIARA power banks", units: 11000, unitsText: "11000" },
    now: NOW,
  });

describe("the monthly progress report", () => {
  it("completion is cumulative corrections over units, two decimals", () => {
    expect(completion(33, 11000)).toBe(0.3);
    expect(completion(1, 3)).toBe(33.33);
    expect(completion(5, null)).toBeNull();
    expect(report().completionPercent).toBe(0.3);
  });
  it("uses the CPSC form's own field names", () => {
    const fields = formRows(report()).map((r) => r.field);
    for (const f of ["Case Number", "Reporting Dates", "Recalling Firm", "Product", "With Consumers: Total Products Affected by Recall", "With Consumers: Corrections this Reporting Period", "With Consumers: Total Cumulative Corrections for Recall"])
      expect(fields).toContain(f);
    expect(formRows(report()).find((r) => r.field === "Recalling Firm")?.value).toBe("Brightline Home (fictional sample firm)");
  });
  it("CSV carries every figure", () => {
    const csv = reportCsv(report());
    expect(csv.split("\n")[0]).toBe("field,cpsc_form_field,value");
    expect(csv).toContain("corrections_cumulative,With Consumers: Total Cumulative Corrections for Recall,33");
    expect(csv).toContain("refunds_paid_usd,,19.00");
    expect(csv).toContain("completion_percent,,0.3");
  });
  it("the template uses only the report's own figures", () => {
    const n = report();
    const t = templateNarrative(n);
    expect(t).toContain("19 refunds were paid through PayPal, $19.00 in all");
    expect(strayFigures(t, n)).toEqual([]);
    expect(narrativeProblems(t, n)).toEqual([]);
  });
  it("a paragraph with an invented figure or an em dash is set aside", () => {
    const n = report();
    expect(strayFigures("Brightline paid 27 refunds and expects 500 more.", n)).toEqual(["27", "500"]);
    expect(strayFigures("Three payouts wait, and nine more are planned.", n)).toEqual(["nine"]);
    expect(narrativeProblems("Refunds went out quickly — 19 of them, which is a good start for the recall.", n)).toContain("an em dash");
  });
  it("Claude sees labelled, formatted figures; the fingerprint ignores the time it was made", () => {
    const n = report();
    expect(promptFigures(n)).toMatchObject({ refunds_paid_total: "$19.00", completion_percent: "0.30", units_affected: 11000 });
    expect(fingerprint(n)).toBe(fingerprint({ ...n, generatedAt: "2030-01-01T00:00:00Z" }));
    expect(fingerprint(n)).not.toBe(fingerprint({ ...n, claimsReceived: 35 }));
  });
});

describe("the corrective-action plan", () => {
  it("the base plan: announcement, two notice waves, three reports due on the 1st", () => {
    const p = basePlan("27056", "2026-10-29");
    expect(p.map((t) => t.kind)).toEqual(["announcement", "notice_wave", "notice_wave", "report", "report", "report"]);
    expect(p.find((t) => t.ref === "plan:27056:report-1")?.name).toBe("Monthly progress report 1, due Nov 1");
    expect(p.find((t) => t.ref === "plan:27056:report-3")?.name).toBe("Monthly progress report 3, due Jan 1");
    expect(p.find((t) => t.ref === "plan:27056:report-2")).toMatchObject({ start: "2026-11-29", dependsOn: "plan:27056:report-1" });
  });
  const row = (id: number, kind: PlanRow["kind"], deps: number[] = [], source: PlanRow["source"] = "seed"): PlanRow => ({
    id,
    name: `Task ${id}`,
    kind,
    start: "2026-11-05",
    durationDays: 2,
    percentDone: 0,
    source,
    ref: null,
    dependencies: deps.map((from) => ({ from, type: 2 })),
    data: {},
  });
  it("rows become a tree with groups and real dependencies", () => {
    const g = toGantt([row(1, "announcement"), row(2, "payout_batch"), row(3, "re_notice", [2], "webhook"), row(4, "report", [1]), row(5, "follow_up", [99])], "2026-11-05");
    expect(g.tasks.map((t) => t.id)).toEqual([1, "g-payouts", "g-follow", "g-reports"]);
    expect(g.tasks.find((t) => t.id === "g-follow")?.children?.map((t) => t.id)).toEqual([3, 5]);
    expect(g.dependencies).toEqual([
      { id: "d2-3", fromTask: 2, toTask: 3, type: 2 },
      { id: "d1-4", fromTask: 1, toTask: 4, type: 2 },
    ]);
  });
  it("the sample firm's repeated history folds under one closed parent in its group, so the plan reads as a plan", () => {
    const seeded = (id: number, kind: PlanRow["kind"], ref: string, deps: number[] = [], data: Record<string, unknown> = {}): PlanRow => ({ ...row(id, kind, deps), ref, data });
    const g = toGantt(
      [
        row(1, "announcement"),
        seeded(2, "payout_batch", "sample-batch:BH-2026-01:2026-10-16", [], { claims: ["a"] }),
        seeded(3, "payout_batch", "sample-batch:BH-2026-01:2026-10-20", [], { claims: ["b", "c"] }),
        row(4, "payout_batch", [], "system"),
        seeded(5, "follow_up", "sample-follow-up:BH-2026-01:2026-10-16", [2]),
        row(6, "re_notice", [2], "webhook"),
      ],
      "2026-11-05",
    );
    const pay = g.tasks.find((t) => t.id === "g-payouts")!;
    expect(pay.children!.map((t) => t.id)).toEqual(["g-payouts-sample", 4]);
    expect(pay.children![0]).toMatchObject({ name: "Sample payout history: 2 batches, 3 refunds", kind: "group", expanded: false, readOnly: true });
    expect(pay.children![0].children!.map((t) => t.id)).toEqual([2, 3]);
    const follow = g.tasks.find((t) => t.id === "g-follow")!;
    expect(follow.children!.map((t) => t.id)).toEqual(["g-follow-sample", 6]);
    expect(follow.children![0]).toMatchObject({ name: "Follow-up checks on the sample batches: 1", expanded: false });
    // Live tasks and re-notices stay in view; the dependencies still cross the fold.
    expect(g.dependencies.map((d) => d.id)).toEqual(["d2-5", "d2-6"]);
  });
  it("records keep their dates; plans can move", () => {
    expect(taskFor(row(2, "payout_batch"), "2026-11-05")).toMatchObject({ readOnly: true, manuallyScheduled: true });
    expect(taskFor(row(4, "report"), "2026-11-05")).toMatchObject({ readOnly: false, constraintType: "startnoearlierthan", constraintDate: "2026-11-05" });
    expect(taskFor(row(3, "re_notice", [], "webhook"), "2026-11-05").cls).toContain("is-live");
    expect(taskFor(row(3, "re_notice", [], "webhook"), "2026-11-05").note).toContain("Added by a PayPal webhook");
    expect(MOVABLE).not.toContain("payout_batch");
    expect(groupFor("notice_wave")).toBe("g-notices");
  });
});

describe("buyers from a sales file", () => {
  const product = { name: "Brightline PowerCell 10K power bank (sample)", sku: "BLH-PC10K" };
  it("the template matches the sample product and not the lamp", () => {
    const r = parseSales(csvTemplate(product), [product, { name: "HAIARA power banks" }], NOW);
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.line, l.matched, l.score])).toEqual([
      [2, true, 1],
      [3, false, 0],
    ]);
    const first = publicLine(r.lines[0]);
    expect(first).not.toHaveProperty("email");
    expect(first.contact).toBe("j•••@example.com");
    expect(first.refundToOriginal).toBe(true);
    expect(r.lines[1].contact).toBe("•••-•••-0134");
  });
  it("a PayPal sale over 180 days old is paid out, not refunded", () => {
    const csv = "order_id,order_date,buyer_email,item_name,paid_with\nX1,2026-03-01,sam@example.com,HAIARA power bank W5 PRO,paypal\n";
    const [l] = parseSales(csv, [{ name: "HAIARA power banks" }], NOW).lines;
    expect(l.matched).toBe(true);
    expect(l.refundToOriginal).toBe(false);
  });
  it("missing columns are explained", () => {
    expect(parseSales("name,email\nA,b@c.d\n", [product], NOW).errors[0]).toContain("item_name");
  });
  it("the notice names the recall and the link", () => {
    const t = noticeText({ firmName: "Brightline Home", product: "HAIARA power banks", recallNumber: "27056", link: "https://x.test/claim/27056?n=abc", refundToOriginal: true });
    expect(t).toContain("CPSC recall 27056");
    expect(t).toContain("https://x.test/claim/27056?n=abc");
    expect(t).not.toMatch(/—/);
  });
});

describe("Info entries for the console", () => {
  it("each says what and why, kindly", () => {
    for (const [id, e] of Object.entries(FIRM_INFO)) {
      expect(e.title, id).toBeTruthy();
      expect(e.what, id).toBeTruthy();
      expect(e.why, id).toBeTruthy();
      expect(JSON.stringify(e), id).not.toMatch(/—|\b(fraud|fake|scam)/i);
    }
  });
});

describe("the console's counters, reconciled", () => {
  it("one line from the same figures says what each counter counts and why they differ", () => {
    const s = { claimsVerified: 30, unitsCorrected: 33, refundsPaid: { count: 25, cents: 87_475 }, verifiedBy: { paid: 25, waiting: 3, unpaid: 2, other: 0 } };
    expect(kpiReconcile(s)).toBe("Of the 30 verified claims, 25 are paid, 3 were sent and wait to be accepted and 2 are not paid yet; together they cover 33 units, as a claim can cover more than one.");
    // The parts add up to the verified claims, and the paid part is the refunds paid counter.
    const v = s.verifiedBy;
    expect(v.paid + v.waiting + v.unpaid + v.other).toBe(s.claimsVerified);
    expect(v.paid).toBe(s.refundsPaid.count);
    expect(kpiReconcile({ claimsVerified: 1, unitsCorrected: 1, refundsPaid: { count: 1, cents: 100 }, verifiedBy: { paid: 1, waiting: 0, unpaid: 0, other: 0 } })).toBe("Of the 1 verified claim, 1 is paid; together they cover 1 unit, one each.");
    // A payment that landed on a claim no longer counted as verified is named, never hidden.
    expect(kpiReconcile({ ...s, refundsPaid: { count: 26, cents: 0 } })).toContain("refunds paid counts every payment that landed on this recall, 26 in all");
  });
  it("the console prints it under the counters, and the home summary counts its parts in the same query family", () => {
    expect(readFileSync(path.join(process.cwd(), "src", "app", "firm", "page.tsx"), "utf8")).toContain("{kpiReconcile(s)}");
    expect(readFileSync(path.join(process.cwd(), "src", "lib", "firm", "home.ts"), "utf8")).toContain("verifiedBy: { paid:");
  });
});
