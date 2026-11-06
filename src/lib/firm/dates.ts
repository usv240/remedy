/**
 * Dates for the firm console, all in UTC so a day means the same thing on the server, in SQL and in the browser.
 *
 * CPSC monthly progress reports: the CPSC's Monthly Progress Report form for corrective action plans (updated 10/2015,
 * cpsc.gov/s3fs-public/MonthlyProgressReport-ElectronicForm_0.pdf) asks for the completed form "by the FIRST of EACH
 * MONTH". So report 1 covers the announcement day to the end of that month and is due on the 1st of the next month;
 * each later report covers one calendar month.
 */

const DAY = 86_400_000;

/** Raw SQL rows bring timestamps as strings (Drizzle's node-postgres driver), so both are taken. */
export const isoDay = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
export const monthOf = (d: Date | string) => new Date(d).toISOString().slice(0, 7);
export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** "2026-11" plus n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthOf(d);
}

export const monthStart = (month: string) => new Date(`${month}-01T00:00:00.000Z`);
export const nextMonthStart = (month: string) => monthStart(addMonths(month, 1));

/** Whole days from a to b (b later), counting calendar days in UTC. */
export function daysBetween(a: Date | string, b: Date | string): number {
  const da = Date.parse(typeof a === "string" ? `${a.slice(0, 10)}T00:00:00Z` : `${isoDay(a)}T00:00:00Z`);
  const db = Date.parse(typeof b === "string" ? `${b.slice(0, 10)}T00:00:00Z` : `${isoDay(b)}T00:00:00Z`);
  return Math.round((db - da) / DAY);
}

export type ReportPeriod = {
  month: string;
  /** 1 for the announcement month. */
  index: number;
  /** First day counted, YYYY-MM-DD (the announcement day for report 1). */
  start: string;
  /** Last day of the month, YYYY-MM-DD. */
  end: string;
  /** The 1st of the next month. */
  dueOn: string;
  /** Counting stops at the end of today while the month is still running. */
  through: string;
  inProgress: boolean;
  /** Exclusive upper bound for SQL: the start of the day after `through`. */
  untilExclusive: Date;
  /** Inclusive lower bound for SQL. */
  fromInclusive: Date;
};

/** The report period for `month` of a recall announced on `announced` (YYYY-MM-DD). Null before the announcement month. */
export function reportPeriod(month: string, announced: string, now: Date): ReportPeriod | null {
  if (!isMonth(month)) return null;
  const first = announced.slice(0, 7);
  if (month < first) return null;
  const index = (Number(month.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(first.slice(5, 7)) + 1;
  const start = month === first ? announced.slice(0, 10) : `${month}-01`;
  const next = nextMonthStart(month);
  const end = isoDay(new Date(next.getTime() - DAY));
  const today = isoDay(now);
  const inProgress = today <= end;
  const through = inProgress ? today : end;
  return {
    month,
    index,
    start,
    end,
    dueOn: isoDay(next),
    through,
    inProgress,
    fromInclusive: new Date(`${start}T00:00:00.000Z`),
    untilExclusive: new Date(Date.parse(`${through}T00:00:00.000Z`) + DAY),
  };
}

/** Every report month from the announcement through `count` months, oldest first. */
export function reportMonths(announced: string, count: number): string[] {
  const first = announced.slice(0, 7);
  return Array.from({ length: count }, (_, i) => addMonths(first, i));
}

/** The next report due on or after today: the report for the current month, due on the 1st of next month. */
export function nextReportDue(announced: string, now: Date): ReportPeriod | null {
  const cur = monthOf(now) < announced.slice(0, 7) ? announced.slice(0, 7) : monthOf(now);
  return reportPeriod(cur, announced, now);
}

const MONTH_NAME = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT_DAY_NO_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "November 2026". */
export const monthName = (month: string) => MONTH_NAME.format(monthStart(month));
/** "Dec 1, 2026". */
export const dayName = (day: string) => SHORT_DAY.format(new Date(`${day.slice(0, 10)}T12:00:00Z`));
/** "Dec 1". */
export const dayShort = (day: string) => SHORT_DAY_NO_YEAR.format(new Date(`${day.slice(0, 10)}T12:00:00Z`));

/** Recency in words: "Today", "Yesterday", "3 days ago", or the date. */
export function whenWords(iso: string, now: Date): string {
  const d = daysBetween(iso, now);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return dayName(iso);
}
