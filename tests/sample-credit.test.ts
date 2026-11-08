import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { noticeText } from "@/lib/firm/buyers";
import { reportPeriod } from "@/lib/firm/dates";
import { basePlan, noteFor, type PlanRow } from "@/lib/firm/plan";
import { buildReport, formRows, reportCsv, type ReportCounts } from "@/lib/firm/report";
import { payoutNote } from "@/lib/payments/payouts";
import { payerWords } from "@/lib/recall/label";
import { isSampleNumber, recallCredit, recallLabel, RecallLabel, SAMPLE_PHOTO_CREDIT } from "@/lib/recall/label";

/**
 * Brightline Home's sample recall BH-2026-01 is fictional, so it is never called a CPSC recall and its photo is never
 * credited to the CPSC: it is "sample recall BH-2026-01", photographed by Dmitry G (Wikimedia Commons, public domain).
 * A real CPSC recall keeps its CPSC name and credit.
 */
const SAMPLE = "BH-2026-01";
const REAL = "27056";
const NOW = new Date("2026-11-07T15:00:00Z");

const counts: ReportCounts = {
  claimsReceived: 3,
  claimsReceivedSample: 3,
  correctionsThisPeriod: 2,
  correctionsCumulative: 2,
  claimsVerified: 2,
  claimsInReview: 1,
  retakesAsked: 0,
  refundsPaidCount: 2,
  refundsPaidCents: 6998,
  replacementsCount: 0,
  replacementsCents: 0,
  unclaimedCount: 0,
  unclaimedCents: 0,
  notifiedEmail: 0,
  notifiedSms: 0,
  notifiedMail: 0,
  contactedEmail: 0,
  contactedOnline: 3,
};
const report = (number: string) =>
  buildReport({
    counts,
    period: reportPeriod("2026-11", "2026-10-20", NOW)!,
    firm: { name: "Brightline Home", isSample: true },
    recall: { number, title: "Brightline 65W Laptop Chargers Recalled", short: "Brightline 65W laptop charger", units: 1200, unitsText: "1,200" },
    now: NOW,
  });

describe("the sample recall's name and credit", () => {
  it("is a sample recall, never a CPSC recall; a real one stays a CPSC recall", () => {
    expect(isSampleNumber(SAMPLE)).toBe(true);
    expect(recallLabel(SAMPLE)).toBe("sample recall BH-2026-01");
    expect(RecallLabel(SAMPLE)).toBe("Sample recall BH-2026-01");
    expect(recallLabel(REAL)).toBe("CPSC recall 27056");
    expect(RecallLabel(REAL)).toBe("CPSC recall 27056");
  });

  it("credits the sample's photo to its photographer, and a real recall's to the CPSC", () => {
    expect(recallCredit(SAMPLE)).toContain(SAMPLE_PHOTO_CREDIT);
    expect(SAMPLE_PHOTO_CREDIT).toMatch(/Dmitry G, Wikimedia Commons, public domain/);
    expect(recallCredit(SAMPLE)).not.toMatch(/CPSC|Consumer Product Safety/);
    expect(recallCredit(REAL)).toBe("Photo and recall data: US Consumer Product Safety Commission.");
  });

  it("the payout note, the buyer notice and the monthly report say sample recall", () => {
    const note = payoutNote({ recallNumber: SAMPLE, recallTitle: "Brightline 65W Laptop Chargers Recalled" }, "Brightline Home");
    expect(note).toContain("(sample recall BH-2026-01)");
    expect(note).not.toContain("CPSC recall");
    expect(payoutNote({ recallNumber: REAL, recallTitle: "HAIARA Power Banks Recalled" }, "Brightline Home")).toContain("(CPSC recall 27056)");
    // A fictional sample firm is never named as the payer of a real recall.
    expect(payoutNote({ recallNumber: REAL, recallTitle: "HAIARA Power Banks Recalled" }, "Brightline Home (sample)")).not.toContain("Brightline");
    expect(payoutNote({ recallNumber: SAMPLE, recallTitle: "Brightline 65W Laptop Chargers Recalled" }, "Brightline Home (sample)")).toContain("from Brightline Home.");
    expect(payerWords(REAL).demo).not.toMatch(/Brightline|Fernway/);
    expect(payerWords(REAL).real).toContain("the recalling firm pays from its own PayPal account");
    expect(payerWords(SAMPLE).demo).toContain("Brightline Home, a fictional sample firm");

    const notice = noticeText({ firmName: "Brightline Home", product: "Brightline 65W laptop charger", recallNumber: SAMPLE, link: "https://example.com/c/x", refundToOriginal: true });
    expect(notice).toContain("(sample recall BH-2026-01)");
    expect(notice).not.toContain("CPSC recall");

    const rows = formRows(report(SAMPLE));
    const product = rows.find((r) => r.field === "Product")!;
    expect(product.value).toBe("Brightline 65W laptop charger (sample recall BH-2026-01)");
    const units = rows.find((r) => r.field === "With Consumers: Total Products Affected by Recall")!;
    expect(units.source).toBe("recall.units (the sample recall's data)");
    expect(reportCsv(report(SAMPLE))).not.toContain("CPSC recall BH");
    expect(formRows(report(REAL)).find((r) => r.field === "Product")!.value).toContain("(CPSC recall 27056)");
  });

  it("the recall plan announces the sample recall without crediting the CPSC", () => {
    const sample = basePlan(SAMPLE, "2026-10-20")[0];
    expect(sample.name).toBe("Sample recall announced");
    expect(basePlan(REAL, "2026-10-20")[0].name).toBe("Recall announced by the CPSC");
    const row = (ref: string): PlanRow => ({ id: 1, name: "x", kind: "announcement", start: "2026-10-20", durationDays: 0, percentDone: 100, source: "seed", ref, dependencies: [], data: {} });
    expect(noteFor(row(sample.ref))).not.toMatch(/CPSC/);
    expect(noteFor(row(basePlan(REAL, "2026-10-20")[0].ref))).toBe("The day the CPSC published the recall.");
  });

  it("no page, email, payout or API text builds 'CPSC recall <number>' by hand", () => {
    // Every recall name goes through recallLabel (src/lib/recall/label.ts), so the sample can never be called a CPSC
    // recall. A literal recall number in example text (for example "CPSC recall 27056") is fine.
    const SRC = join(__dirname, "..", "src");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
      });
    const offenders = files(SRC)
      .filter((f) => !f.endsWith(join("recall", "label.ts")))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split(/\r?\n/)
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => /CPSC recall (\$\{|\{)|\(CPSC \{/.test(line)),
      )
      .map(({ f, i }) => `${f.slice(SRC.length + 1)}:${i}`);
    expect(offenders).toEqual([]);
  });
});
