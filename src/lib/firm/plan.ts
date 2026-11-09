/**
 * The corrective-action plan as Bryntum Gantt reads it. plan_task rows (some written by the firm, some by the payments
 * engine when a payout batch goes out or a payout waits to be accepted) become a tree: the announcement, then groups
 * for notices, payouts, follow-up and the CPSC reports. Dependencies are plan_task's own ("finish to start" unless the
 * row says otherwise). Pure and client safe.
 */
import { isSampleNumber, sampleFirmOf } from "@/lib/recall/label";
import { addMonths, isoDay, reportMonths } from "./dates";

export type PlanKind = "announcement" | "notice_wave" | "report" | "payout_batch" | "follow_up" | "re_notice" | "milestone" | "other";
export type PlanSource = "seed" | "person" | "webhook" | "system";

/** A plan_task row as the console reads it. */
export type PlanRow = {
  id: number;
  name: string;
  kind: PlanKind;
  start: string;
  durationDays: number;
  percentDone: number;
  source: PlanSource;
  ref: string | null;
  /** plan_task.dependencies: predecessors of this task. */
  dependencies: { from: number; type?: number; lag?: number; lagUnit?: string }[];
  data: Record<string, unknown>;
};

export type GanttTask = {
  id: number | string;
  name: string;
  startDate: string;
  duration: number;
  durationUnit: "day";
  percentDone: number;
  kind: PlanKind | "group";
  source: PlanSource | "group";
  /** What the row is about, in plain words, for the tooltip and the screen reader table. */
  note: string;
  readOnly: boolean;
  /** Keeps the planned start; a dependency can still push the task later. */
  constraintType?: "startnoearlierthan";
  constraintDate?: string;
  manuallyScheduled?: boolean;
  cls?: string;
  expanded?: boolean;
  children?: GanttTask[];
};

export type GanttDependency = { id: string; fromTask: number | string; toTask: number | string; type: number; lag?: number; lagUnit?: "day" };

export const GROUPS = [
  { id: "g-notices", name: "Notices", kinds: ["notice_wave"] },
  { id: "g-payouts", name: "Payout batches", kinds: ["payout_batch"] },
  { id: "g-follow", name: "Follow-up", kinds: ["follow_up", "re_notice"] },
  { id: "g-reports", name: "CPSC monthly reports", kinds: ["report"] },
] as const;

export const groupFor = (kind: PlanKind) => GROUPS.find((g) => (g.kinds as readonly string[]).includes(kind))?.id ?? null;

/** Kinds a person may move: plans, not records of what already happened (an announcement, a payout batch). */
export const MOVABLE: PlanKind[] = ["notice_wave", "report", "follow_up", "re_notice", "milestone", "other"];

const SOURCE_NOTE: Record<PlanSource, string> = {
  seed: "Part of the plan",
  person: "Changed by a person at the firm",
  webhook: "Added by a PayPal webhook",
  system: "Added by Remedy's payments engine",
};

export function noteFor(r: PlanRow): string {
  const d = r.data as { status?: string; totalCents?: number; claims?: unknown[]; sample?: boolean; payoutBatchId?: string };
  if (r.kind === "re_notice") return `${d.status === "returned" ? "A payout came back to the firm" : "A payout is waiting to be accepted"}, so the owner gets a friendly reminder. ${SOURCE_NOTE[r.source]}.`;
  if (r.kind === "payout_batch") {
    const n = Array.isArray(d.claims) ? d.claims.length : null;
    return `${n === null ? "A PayPal Payouts batch" : `${n} ${n === 1 ? "refund" : "refunds"} in one PayPal Payouts batch`}${d.totalCents ? `, $${(d.totalCents / 100).toFixed(2)}` : ""}.${d.sample ? " Sample history, not paid." : ""} ${SOURCE_NOTE[r.source]}.`;
  }
  if (r.kind === "follow_up") return `Thirty days after the batch, check for payouts nobody accepted. ${SOURCE_NOTE[r.source]}.`;
  if (r.kind === "report") return `Prepare and file the CPSC monthly progress report. The CPSC asks for it by the first of each month. ${SOURCE_NOTE[r.source]}.`;
  if (r.kind === "notice_wave") return `Send recall notices with a personal claim link. ${SOURCE_NOTE[r.source]}.`;
  if (r.kind === "announcement") return isSampleNumber(r.ref?.split(":")[1] ?? "") ? `The day the sample recall was announced. ${sampleFirmOf(r.ref?.split(":")[1] ?? "") ?? "The sample firm"} and its recall are fictional.` : "The day the CPSC published the recall.";
  return SOURCE_NOTE[r.source];
}

/**
 * The sample firm's seeded history repeats one task per day (a payout batch, and its follow-up thirty days on). Each
 * set folds under one closed parent inside its group, so the plan reads as a plan: notices, live batches, re-notices
 * and reports, with the history a press away. Matched by the seed's own refs (scripts/seed-firm.ts).
 */
export const SAMPLE_SETS: { id: string; group: string; ref: string; name: (n: number, refunds: number) => string }[] = [
  { id: "g-payouts-sample", group: "g-payouts", ref: "sample-batch:", name: (n: number, refunds: number) => `Sample payout history: ${n} ${n === 1 ? "batch" : "batches"}, ${refunds} ${refunds === 1 ? "refund" : "refunds"}` },
  { id: "g-follow-sample", group: "g-follow", ref: "sample-follow-up:", name: (n: number) => `Follow-up checks on the sample batches: ${n}` },
];

const groupTask = (id: string, name: string, children: GanttTask[], expanded: boolean): GanttTask => ({
  id,
  name,
  startDate: [...children].sort((a, b) => a.startDate.localeCompare(b.startDate))[0].startDate,
  duration: 1,
  durationUnit: "day",
  percentDone: 0,
  kind: "group",
  source: "group",
  note: name,
  readOnly: true,
  expanded,
  children,
});

/** plan_task rows to the Gantt's tree and dependency list. Groups that would be empty are left out. */
export function toGantt(rows: PlanRow[], today: string): { tasks: GanttTask[]; dependencies: GanttDependency[] } {
  const byGroup = new Map<string, GanttTask[]>();
  const bySet = new Map<string, { tasks: GanttTask[]; refunds: number }>();
  const roots: GanttTask[] = [];
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const t = taskFor(r, today);
    const set = SAMPLE_SETS.find((x) => r.ref?.startsWith(x.ref));
    if (set) {
      const cur = bySet.get(set.id) ?? { tasks: [], refunds: 0 };
      const claims = (r.data as { claims?: unknown[] }).claims;
      bySet.set(set.id, { tasks: [...cur.tasks, t], refunds: cur.refunds + (Array.isArray(claims) ? claims.length : 0) });
      continue;
    }
    const g = groupFor(r.kind);
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
    else roots.push(t);
  }
  // Each folded history goes first in its group, before the tasks that are live or still to come.
  for (const set of SAMPLE_SETS) {
    const got = bySet.get(set.id);
    if (got?.tasks.length) byGroup.set(set.group, [groupTask(set.id, set.name(got.tasks.length, got.refunds), got.tasks, false), ...(byGroup.get(set.group) ?? [])]);
  }
  const groups: GanttTask[] = GROUPS.filter((g) => byGroup.has(g.id)).map((g) => groupTask(g.id, g.name, byGroup.get(g.id)!, true));
  const dependencies: GanttDependency[] = [];
  for (const r of rows)
    for (const d of r.dependencies ?? [])
      if (ids.has(d.from)) dependencies.push({ id: `d${d.from}-${r.id}`, fromTask: d.from, toTask: r.id, type: d.type ?? 2, ...(d.lag ? { lag: d.lag, lagUnit: "day" as const } : {}) });
  return { tasks: [...roots, ...groups], dependencies };
}

export function taskFor(r: PlanRow, today: string): GanttTask {
  const movable = MOVABLE.includes(r.kind);
  return {
    id: r.id,
    name: r.name,
    startDate: r.start,
    duration: r.kind === "announcement" ? 0 : Math.max(0.5, r.durationDays),
    durationUnit: "day",
    percentDone: r.percentDone,
    kind: r.kind,
    source: r.source,
    note: noteFor(r),
    readOnly: !movable,
    // Records keep their date; plans keep theirs unless a predecessor pushes them later.
    ...(movable ? { constraintType: "startnoearlierthan" as const, constraintDate: r.start } : { manuallyScheduled: true }),
    cls: [`k-${r.kind}`, r.source === "webhook" || (r.kind === "re_notice" && r.start >= today) ? "is-live" : ""].filter(Boolean).join(" "),
  };
}

/** The plan every recall starts with, from its announcement date. Keyed refs make adding it idempotent. */
export function basePlan(recallNumber: string, announced: string) {
  const day = (offset: number) => isoDay(new Date(Date.parse(`${announced}T00:00:00Z`) + offset * 86_400_000));
  const months = reportMonths(announced, 3);
  const ref = (k: string) => `plan:${recallNumber}:${k}`;
  return [
    { ref: ref("announcement"), name: isSampleNumber(recallNumber) ? "Sample recall announced" : "Recall announced by the CPSC", kind: "announcement" as const, start: announced, duration: 0, dependsOn: null },
    { ref: ref("notice-1"), name: "Notice wave 1: email buyers in the sales records", kind: "notice_wave" as const, start: announced, duration: 4, dependsOn: ref("announcement") },
    { ref: ref("notice-2"), name: "Notice wave 2: reminder to buyers who have not claimed", kind: "notice_wave" as const, start: day(14), duration: 3, dependsOn: ref("notice-1") },
    ...months.map((m, i) => {
      const due = `${addMonths(m, 1)}-01`;
      const start = isoDay(new Date(Date.parse(`${due}T00:00:00Z`) - 2 * 86_400_000));
      return {
        ref: ref(`report-${i + 1}`),
        name: `Monthly progress report ${i + 1}, due ${new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${due}T12:00:00Z`))} 1`,
        kind: "report" as const,
        start,
        duration: 2,
        dependsOn: i === 0 ? ref("announcement") : ref(`report-${i}`),
      };
    }),
  ];
}
