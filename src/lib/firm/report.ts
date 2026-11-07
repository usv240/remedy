/**
 * The CPSC monthly progress report: the numbers (counted in SQL, src/lib/firm/report-data.ts), laid out with the field
 * names of the CPSC's own form, a CSV, and the plain template the narrative falls back to. Pure and client safe.
 *
 * Field names follow "CPSC Monthly Progress Report for Corrective Action Plans (CAP)", updated 10/2015
 * (https://www.cpsc.gov/s3fs-public/MonthlyProgressReport-ElectronicForm_0.pdf), which firms now file through the
 * Monthly Progress Report System (https://www.cpsc.gov/Business--Manufacturing/Recall-Guidance/monthly-progress-report-system).
 * The Product Safety Planning, Reporting, and Recall Handbook says the CPSC uses these reports to evaluate "number of
 * products remedied, number of consumers notified of the recall, and any post-recall announcement incidents and
 * injuries" (https://www.cpsc.gov/s3fs-public/RecallHandbookFINAL9_2technicalrevision_3052025.pdf).
 */
import { recallDataSource, recallLabel } from "@/lib/recall/label";
import { dayName, monthName, type ReportPeriod } from "./dates";

export type ReportCounts = {
  claimsReceived: number;
  claimsReceivedSample: number;
  /** Units verified made safe this period: corrections. */
  correctionsThisPeriod: number;
  /** Units verified made safe from the announcement to the end of the period. */
  correctionsCumulative: number;
  claimsVerified: number;
  claimsInReview: number;
  retakesAsked: number;
  refundsPaidCount: number;
  refundsPaidCents: number;
  replacementsCount: number;
  replacementsCents: number;
  unclaimedCount: number;
  unclaimedCents: number;
  notifiedEmail: number;
  notifiedSms: number;
  notifiedMail: number;
  contactedEmail: number;
  contactedOnline: number;
};

export type ReportNumbers = ReportCounts & {
  firmName: string;
  firmIsSample: boolean;
  recallNumber: string;
  recallTitle: string;
  product: string;
  unitsAffected: number | null;
  unitsText: string;
  period: Pick<ReportPeriod, "month" | "index" | "start" | "end" | "dueOn" | "through" | "inProgress">;
  /** Cumulative corrections over units affected, as a percent with two decimals. Null when units are unknown. */
  completionPercent: number | null;
  generatedAt: string;
};

export function buildReport(o: {
  counts: ReportCounts;
  period: ReportPeriod;
  firm: { name: string; isSample: boolean };
  recall: { number: string; title: string; short: string; units: number | null; unitsText: string };
  now: Date;
}): ReportNumbers {
  const { counts, period, recall } = o;
  return {
    ...counts,
    firmName: o.firm.name,
    firmIsSample: o.firm.isSample,
    recallNumber: recall.number,
    recallTitle: recall.title,
    product: recall.short,
    unitsAffected: recall.units,
    unitsText: recall.unitsText,
    period: { month: period.month, index: period.index, start: period.start, end: period.end, dueOn: period.dueOn, through: period.through, inProgress: period.inProgress },
    completionPercent: completion(counts.correctionsCumulative, recall.units),
    generatedAt: o.now.toISOString(),
  };
}

export function completion(corrected: number, units: number | null): number | null {
  if (!units || units <= 0) return null;
  return Math.round((corrected / units) * 10_000) / 100;
}

const int = new Intl.NumberFormat("en-US");
export const fmtInt = (n: number) => int.format(n);
export const fmtUsd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtPct = (p: number | null) => (p === null ? "Not known" : `${p.toFixed(2)}%`);

export type FormRow = { section: string; field: string; value: string; source: string; fromForm: boolean };

/**
 * The report as the CPSC form's rows, with Remedy's own payment figures after them. `fromForm` marks the form's own
 * fields; a firm copies those into the Monthly Progress Report System. Fields Remedy does not track say so.
 */
export function formRows(n: ReportNumbers): FormRow[] {
  const notTracked = "Not tracked in Remedy. Add from your records.";
  const p = n.period;
  const r = (section: string, field: string, value: string, source: string, fromForm = true): FormRow => ({ section, field, value, source, fromForm });
  return [
    r("Header", "Case Number", "Add your CPSC case number", "Given by your Compliance Officer"),
    r("Header", "Reporting Dates", `${dayName(p.start)} to ${dayName(p.end)}${p.inProgress ? ` (counted through ${dayName(p.through)})` : ""}`, "Report period"),
    r("Header", "Recalling Firm", n.firmIsSample ? `${n.firmName} (fictional sample firm)` : n.firmName, "firm"),
    r("Header", "Product", `${n.product} (${recallLabel(n.recallNumber)})`, "recall"),
    r("I) Products corrected", "With Consumers: Total Products Affected by Recall", n.unitsAffected === null ? n.unitsText || "Not known" : fmtInt(n.unitsAffected), `recall.units (${recallDataSource(n.recallNumber)})`),
    r("I) Products corrected", "With Consumers: Corrections this Reporting Period", fmtInt(n.correctionsThisPeriod), "Units on claims verified made safe in the period"),
    r("I) Products corrected", "With Consumers: Total Cumulative Corrections for Recall", fmtInt(n.correctionsCumulative), "Units on claims verified made safe since the announcement"),
    r("I) Products corrected", "With Manufacturer, Distributor and Retailers", notTracked, "Not in Remedy"),
    r("II) Incident update", "Incidents, Injuries, Death (before and after the recall)", notTracked, "Not in Remedy"),
    r("III) Notifications", "Consumers notified this reporting period by Email", fmtInt(n.notifiedEmail), "notice rows sent by email"),
    r("III) Notifications", "Consumers notified this reporting period by Phone (text message)", fmtInt(n.notifiedSms), "notice rows sent by text"),
    r("III) Notifications", "Consumers notified this reporting period by Regular Mail", fmtInt(n.notifiedMail), "notice rows sent by letter"),
    r("III) Notifications", "Consumers who contacted your Firm this reporting period: Email", fmtInt(n.contactedEmail), "Claims that arrived by email"),
    r("III) Notifications", "Consumers who contacted your Firm this reporting period: Other (online claim)", fmtInt(n.contactedOnline), "Claims sent through a Remedy claim link or page"),
    r("Remedy", "Claims received", fmtInt(n.claimsReceived), "claim rows created in the period", false),
    r("Remedy", "Claims verified", fmtInt(n.claimsVerified), "Verified by the checks or approved by a reviewer", false),
    r("Remedy", "Refunds paid", `${fmtInt(n.refundsPaidCount)} (${fmtUsd(n.refundsPaidCents)})`, "PayPal payouts and refunds that landed in the period", false),
    r("Remedy", "Replacements", `${fmtInt(n.replacementsCount)} (${fmtUsd(n.replacementsCents)})`, "Replacement orders paid in the period", false),
    r("Remedy", "Payouts waiting to be accepted", `${fmtInt(n.unclaimedCount)} (${fmtUsd(n.unclaimedCents)})`, "Sent through PayPal and not yet accepted by the owner", false),
    r("Remedy", "Completion", fmtPct(n.completionPercent), "Cumulative corrections over products affected", false),
  ];
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The report as CSV: one machine-friendly row per figure, plus the CPSC field name it belongs to. */
export function reportCsv(n: ReportNumbers): string {
  const rows: (string | number)[][] = [
    ["field", "cpsc_form_field", "value"],
    ["recall_number", "Product", n.recallNumber],
    ["firm", "Recalling Firm", n.firmIsSample ? `${n.firmName} (fictional sample firm)` : n.firmName],
    ["period_start", "Reporting Dates", n.period.start],
    ["period_end", "Reporting Dates", n.period.end],
    ["counted_through", "", n.period.through],
    ["report_number", "", n.period.index],
    ["due_on", "", n.period.dueOn],
    ["products_affected", "With Consumers: Total Products Affected by Recall", n.unitsAffected ?? ""],
    ["corrections_this_period", "With Consumers: Corrections this Reporting Period", n.correctionsThisPeriod],
    ["corrections_cumulative", "With Consumers: Total Cumulative Corrections for Recall", n.correctionsCumulative],
    ["notified_email", "Consumers notified by Email", n.notifiedEmail],
    ["notified_phone", "Consumers notified by Phone", n.notifiedSms],
    ["notified_mail", "Consumers notified by Regular Mail", n.notifiedMail],
    ["contacted_email", "Consumers who contacted your Firm: Email", n.contactedEmail],
    ["contacted_online", "Consumers who contacted your Firm: Other", n.contactedOnline],
    ["claims_received", "", n.claimsReceived],
    ["claims_received_sample", "", n.claimsReceivedSample],
    ["claims_verified", "", n.claimsVerified],
    ["claims_in_review", "", n.claimsInReview],
    ["retakes_asked", "", n.retakesAsked],
    ["refunds_paid_count", "", n.refundsPaidCount],
    ["refunds_paid_usd", "", (n.refundsPaidCents / 100).toFixed(2)],
    ["replacements_count", "", n.replacementsCount],
    ["replacements_usd", "", (n.replacementsCents / 100).toFixed(2)],
    ["unclaimed_count", "", n.unclaimedCount],
    ["unclaimed_usd", "", (n.unclaimedCents / 100).toFixed(2)],
    ["completion_percent", "", n.completionPercent ?? ""],
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** The plain paragraph used when Claude is not connected, and the shape Claude's paragraph must keep to. */
export function templateNarrative(n: ReportNumbers): string {
  const p = n.period;
  const period = `${dayName(p.start)} to ${dayName(p.through)}`;
  const parts = [
    `From ${period}, ${n.firmName} received ${fmtInt(n.claimsReceived)} ${n.claimsReceived === 1 ? "claim" : "claims"} for the ${n.product} recall and verified ${fmtInt(n.claimsVerified)} made safe.`,
    `${fmtInt(n.refundsPaidCount)} ${n.refundsPaidCount === 1 ? "refund was" : "refunds were"} paid through PayPal, ${fmtUsd(n.refundsPaidCents)} in all${n.replacementsCount ? `, and ${fmtInt(n.replacementsCount)} ${n.replacementsCount === 1 ? "owner chose" : "owners chose"} a replacement` : ""}.`,
    n.unclaimedCount ? `${fmtInt(n.unclaimedCount)} ${n.unclaimedCount === 1 ? "payout is" : "payouts are"} waiting to be accepted, and a friendly reminder is planned.` : null,
    n.claimsInReview ? `${fmtInt(n.claimsInReview)} ${n.claimsInReview === 1 ? "claim is" : "claims are"} with a reviewer.` : null,
    n.completionPercent === null
      ? `In total ${fmtInt(n.correctionsCumulative)} units have been corrected.`
      : `In total ${fmtInt(n.correctionsCumulative)} of ${fmtInt(n.unitsAffected ?? 0)} units have been corrected, ${fmtPct(n.completionPercent)} of the recall.`,
  ];
  return parts.filter(Boolean).join(" ");
}

/** Every figure the narrative may use, in the forms a writer might print it. Dates count too. */
export function allowedFigures(n: ReportNumbers): Set<string> {
  const out = new Set<string>();
  const add = (v: number | string | null | undefined) => {
    if (v === null || v === undefined || v === "") return;
    const s = String(v);
    out.add(s);
    out.add(s.replace(/,/g, ""));
  };
  for (const k of Object.keys(n) as (keyof ReportNumbers)[]) {
    const v = n[k];
    if (typeof v === "number") {
      add(v);
      add(fmtInt(v));
    }
  }
  for (const c of [n.refundsPaidCents, n.replacementsCents, n.unclaimedCents]) {
    add((c / 100).toFixed(2));
    add(fmtUsd(c).slice(1));
    if (c % 100 === 0) add(fmtInt(c / 100));
  }
  if (n.completionPercent !== null) {
    add(n.completionPercent.toFixed(2));
    add(n.completionPercent.toFixed(1));
    add(String(Math.round(n.completionPercent)));
  }
  add(n.recallNumber);
  add(n.unitsAffected);
  if (n.unitsAffected) add(fmtInt(n.unitsAffected));
  for (const d of [n.period.start, n.period.end, n.period.through, n.period.dueOn]) {
    const [y, m, day] = d.split("-");
    add(y);
    add(Number(day));
    add(Number(m));
    add(day);
    add(m);
  }
  add(n.period.index);
  for (const w of [n.product, n.recallTitle, n.firmName]) for (const m of w.match(/\d+(?:\.\d+)?/g) ?? []) add(m);
  return out;
}

/** The figures in a paragraph that are not in the report. Empty means every number came from SQL. */
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** The figures in a paragraph that are not in the report, in digits or as words up to twenty. Empty means every number came from SQL. */
export function strayFigures(text: string, n: ReportNumbers): string[] {
  const ok = allowedFigures(n);
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const digits = found.map((f) => f.replace(/[.,]$/, "")).filter((f) => !ok.has(f) && !ok.has(f.replace(/,/g, "")));
  const words = (text.toLowerCase().match(/\b[a-z]+\b/g) ?? []).filter((w) => WORDS.includes(w) && !ok.has(String(WORDS.indexOf(w))) && w !== "one");
  return [...digits, ...words];
}

export const reportTitle = (n: ReportNumbers) => `Monthly progress report ${n.period.index}, ${monthName(n.period.month)}`;
