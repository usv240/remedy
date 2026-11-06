"use client";

import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import type { Gantt, TaskModel } from "@bryntum/gantt";
import { BryntumGantt, BryntumScheduler } from "@bryntum/gantt-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureBryntumTheme } from "@/components/gantt/bryntum";
import { dayShort } from "@/lib/firm/dates";
import { MOVABLE, type GanttDependency, type GanttTask, type PlanKind } from "@/lib/firm/plan";
import type { ReviewEvent } from "@/lib/firm/plan-data";
import { FirmInfo } from "./FirmInfo";

export type PlanData = {
  recall: { number: string; short: string; announced: string };
  today: string;
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  schedule: {
    resources: { id: string; name: string; role: string }[];
    events: ReviewEvent[];
    hours: number;
  };
};

type Flat = {
  id: number | string;
  name: string;
  startDate: string;
  duration: number;
  percentDone: number;
  kind: GanttTask["kind"];
  source: GanttTask["source"];
  note: string;
  readOnly: boolean;
};
const flatten = (tasks: GanttTask[]): Flat[] => tasks.flatMap((t) => [...(t.kind === "group" ? [] : [t as Flat]), ...flatten(t.children ?? [])]);
const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const KIND_WORD: Record<string, string> = {
  announcement: "Announcement",
  notice_wave: "Notice",
  report: "CPSC report",
  payout_batch: "Payout batch",
  follow_up: "Follow-up",
  re_notice: "Re-notice",
  milestone: "Milestone",
  other: "Task",
};
const SOURCE_WORD: Record<string, string> = {
  seed: "Plan",
  person: "A person",
  webhook: "PayPal webhook",
  system: "Payments engine",
  group: "",
};

/**
 * Bryntum marks each task and event bar role=button inside its treegrid, which ARIA does not allow there (axe:
 * aria-required-children). Every bar's facts are already in the grid's own rows (name, start, days) and in the task
 * list below, so the bars are left as plain drawings with a tooltip, the tree's expander icons are hidden from
 * screen readers (the row itself expands with the keyboard), and parent rows lose an aria-owns ARIA does not allow.
 */
function useBryntumA11y(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fix = () => {
      for (const b of el.querySelectorAll<HTMLElement>(".b-gantt-task-wrap:is([role], [tabindex]), .b-sch-event-wrap:is([role], [tabindex])")) {
        const name = b.getAttribute("aria-label");
        if (name && !b.title) b.title = name;
        b.removeAttribute("role");
        b.removeAttribute("aria-label");
        b.removeAttribute("aria-roledescription");
        b.removeAttribute("tabindex");
      }
      for (const i of el.querySelectorAll<HTMLElement>(".b-tree-expander[aria-label]")) i.removeAttribute("aria-label");
      for (const i of el.querySelectorAll<HTMLElement>(".b-tree-expander:not([aria-hidden])")) i.setAttribute("aria-hidden", "true");
      // A parent row "owns" its child rows, which ARIA does not allow; aria-level and aria-posinset already say it.
      for (const r of el.querySelectorAll<HTMLElement>("[role=row][aria-owns]")) r.removeAttribute("aria-owns");
    };
    fix();
    const watch = new MutationObserver(fix);
    watch.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-label", "tabindex", "aria-owns"],
    });
    return () => watch.disconnect();
  }, [root]);
}

export function PlanGantt({ data }: { data: PlanData }) {
  const gantt = useRef<{ instance: Gantt } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const schedBox = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<Flat[]>(() => flatten(data.tasks));
  const [live, setLive] = useState(false);
  const [fresh, setFresh] = useState<{
    name: string;
    note: string;
    source: string;
  } | null>(null);
  const movable = tasks.filter((t) => MOVABLE.includes(t.kind as PlanKind));
  const [pick, setPick] = useState<string>(String(movable[0]?.id ?? ""));
  const picked = tasks.find((t) => String(t.id) === pick);
  const [start, setStart] = useState(picked?.startDate ?? data.today);
  const [days, setDays] = useState(String(picked?.duration ?? 1));
  const [status, setStatus] = useState<{
    text: string;
    tone?: "attention" | "positive";
  } | null>(null);
  useBryntumA11y(box);
  useBryntumA11y(schedBox);

  // Keep Bryntum's theme in step with the site's light and dark mode.
  useEffect(() => {
    const watch = new MutationObserver(() => void ensureBryntumTheme());
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => watch.disconnect();
  }, []);

  const project = useMemo(
    () => ({
      tasksData: data.tasks,
      dependenciesData: data.dependencies,
      startDate: addDays(data.recall.announced, -2),
    }),
    [data],
  );
  const range = useMemo(() => {
    const ends = flatten(data.tasks).map((t) => addDays(t.startDate, Math.ceil(t.duration)));
    const last = ends.sort().at(-1) ?? addDays(data.today, 60);
    return { start: addDays(data.recall.announced, -3), end: addDays(last, 4) };
  }, [data]);

  const save = useCallback(async (id: number | string, startDate: string, duration: number) => {
    const r = await fetch("/api/firm/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, start: startDate, duration_days: duration }),
    });
    const j = (await r.json()) as {
      data: { id: number; start: string; durationDays: number } | null;
      error: { message: string } | null;
    };
    return j;
  }, []);

  const afterDrag = useCallback(
    async (records: TaskModel[]) => {
      const g = gantt.current?.instance;
      if (!g) return;
      await g.project.commitAsync();
      for (const rec of records) {
        if (typeof rec.id !== "number") continue;
        const s = localIso(rec.startDate as Date);
        const j = await save(rec.id, s, Number(rec.duration));
        if (j.error) setStatus({ text: j.error.message, tone: "attention" });
        else {
          setTasks((list) => list.map((t) => (t.id === rec.id ? { ...t, startDate: s, duration: Number(rec.duration) } : t)));
          setStatus({
            text: `Moved "${rec.name}" to ${dayShort(s)}. Saved.`,
            tone: "positive",
          });
        }
      }
    },
    [save],
  );

  // Live: a new plan_task row (a payout batch, a re-notice after an UNCLAIMED payout) appears without a reload.
  useEffect(() => {
    const es = new EventSource("/api/firm/live");
    es.addEventListener("ready", () => setLive(true));
    es.onerror = () => setLive(false);
    es.addEventListener("task", async (e) => {
      const d = JSON.parse((e as MessageEvent).data) as {
        task: GanttTask;
        groupId: string | null;
        dependencies: GanttDependency[];
        source: string;
        kind: string;
      };
      const g = gantt.current?.instance;
      if (!g) return;
      const store = g.project.taskStore;
      if (store.getById(d.task.id)) return;
      const task = { ...d.task, cls: `${d.task.cls ?? ""} is-fresh`.trim() };
      let parent = d.groupId ? (store.getById(d.groupId) as TaskModel | undefined) : undefined;
      if (d.groupId && !parent) {
        const names: Record<string, string> = {
          "g-notices": "Notices",
          "g-payouts": "Payout batches",
          "g-follow": "Follow-up",
          "g-reports": "CPSC monthly reports",
        };
        [parent] = (store.rootNode as TaskModel).appendChild({
          id: d.groupId,
          name: names[d.groupId] ?? "Tasks",
          expanded: true,
          readOnly: true,
          kind: "group",
          source: "group",
        } as never) as unknown as TaskModel[];
      }
      const target = (parent ?? store.rootNode) as TaskModel;
      const added = target.appendChild(task as never) as unknown as TaskModel | TaskModel[];
      const rec = Array.isArray(added) ? added[0] : added;
      const deps = d.dependencies.filter((x) => store.getById(x.fromTask) && store.getById(x.toTask));
      if (deps.length) g.project.dependencyStore.add(deps);
      await g.project.commitAsync();
      if (rec)
        void g.scrollTaskIntoView(rec, {
          highlight: true,
          animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          block: "center",
        });
      setTasks((list) => [...list, task as Flat]);
      setFresh({
        name: d.task.name,
        note: d.task.note,
        source: SOURCE_WORD[d.source] ?? d.source,
      });
    });
    return () => es.close();
  }, []);

  function choose(id: string) {
    setPick(id);
    const t = tasks.find((x) => String(x.id) === id);
    if (t) {
      setStart(t.startDate);
      setDays(String(t.duration));
    }
  }

  async function moveWithForm(e: React.FormEvent) {
    e.preventDefault();
    const t = tasks.find((x) => String(x.id) === pick);
    const n = Number(days);
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !(n >= 0.5)) {
      setStatus({
        text: "Pick a task, a start date and a length of at least half a day.",
        tone: "attention",
      });
      return;
    }
    const j = await save(t.id, start, n);
    if (j.error) return setStatus({ text: j.error.message, tone: "attention" });
    const g = gantt.current?.instance;
    const rec = g?.project.taskStore.getById(t.id) as TaskModel | undefined;
    if (g && rec) {
      rec.set({
        constraintType: "startnoearlierthan",
        constraintDate: new Date(`${start}T00:00:00`),
        startDate: new Date(`${start}T00:00:00`),
        duration: n,
      } as never);
      await g.project.commitAsync();
    }
    setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, startDate: start, duration: n } : x)));
    setStatus({
      text: `Moved "${t.name}" to start ${dayShort(start)}, ${n} ${n === 1 ? "day" : "days"} long. Saved.`,
      tone: "positive",
    });
  }

  const sched = useMemo(() => {
    const now = Date.parse(`${data.today}T12:00:00Z`);
    return { start: new Date(now - 6 * DAY), end: new Date(now + 3 * DAY) };
  }, [data.today]);

  return (
    <div className="plan">
      <div className="plan-live" aria-live="polite">
        <span>
          <span className="plan-dot" data-on={live ? "" : undefined} aria-hidden="true" />
          {live ? "Live: new tasks from PayPal appear here" : "Connecting for live updates"}
        </span>
        <ul className="plan-legend" aria-label="Colors">
          <li style={{ ["--k" as string]: "var(--positive)" }}>Notices</li>
          <li style={{ ["--k" as string]: "var(--chart-2)" }}>Payout batches</li>
          <li style={{ ["--k" as string]: "var(--attention)" }}>Follow-up and re-notices</li>
          <li style={{ ["--k" as string]: "var(--chart-3)" }}>CPSC reports</li>
        </ul>
      </div>
      {fresh && (
        <p className="plan-new" role="status" data-testid="plan-fresh">
          <strong>New task: {fresh.name}.</strong> {fresh.note} Added by {fresh.source.toLowerCase() || "Remedy"}, just now.
        </p>
      )}

      <div className="plan-gantt" ref={box} data-testid="plan-gantt">
        <BryntumGantt
          ref={gantt as never}
          project={project as never}
          startDate={range.start}
          endDate={range.end}
          viewPreset="weekAndDayLetter"
          rowHeight={40}
          barMargin={9}
          columns={[
            { type: "name", text: "Task", width: 330, field: "name" },
            { type: "startdate", text: "Start", width: 92, format: "MMM D" },
            { type: "duration", text: "Days", width: 84 },
          ]}
          taskEditFeature={false}
          taskMenuFeature={false}
          cellEditFeature={false}
          cellMenuFeature={false}
          scheduleMenuFeature={false}
          headerMenuFeature={false}
          taskDragCreateFeature={false}
          dependencyEditFeature={false}
          dependenciesFeature={{ allowCreate: false }}
          timeRangesFeature={{ showCurrentTimeLine: true }}
          projectLinesFeature={false}
          taskTooltipFeature={{
            template: ({ taskRecord }: { taskRecord: TaskModel & { note?: string } }) =>
              `<div class="plan-tip"><b>${escapeHtml(String(taskRecord.name))}</b><br>${escapeHtml(String((taskRecord as { note?: string }).note ?? ""))}</div>`,
          }}
          onAfterTaskDrop={({ taskRecords, valid }: { taskRecords: TaskModel[]; valid: boolean }) => {
            if (valid) void afterDrag(taskRecords);
          }}
          onTaskResizeEnd={({ taskRecord, changed }: { taskRecord: TaskModel; changed: boolean }) => {
            if (changed) void afterDrag([taskRecord]);
          }}
        />
      </div>

      <section className="firm-section" aria-labelledby="move-h">
        <h2 id="move-h" className="firm-h2">
          Move a task <FirmInfo id="firm.move-task" label="" />
        </h2>
        <form className="firm-form" onSubmit={(e) => void moveWithForm(e)}>
          <label className="firm-field wide">
            Task
            <select value={pick} onChange={(e) => choose(e.target.value)}>
              {movable.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name} ({dayShort(t.startDate)})
                </option>
              ))}
            </select>
          </label>
          <label className="firm-field">
            Starts
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="firm-field" style={{ maxWidth: "8rem" }}>
            Days
            <input type="number" min={0.5} max={120} step={0.5} value={days} onChange={(e) => setDays(e.target.value)} required />
          </label>
          <button type="submit" className="btn btn-ink">
            Move it
          </button>
        </form>
        <p className="firm-status" role="status" data-tone={status?.tone} style={{ marginTop: 8 }}>
          {status?.text ?? "Drag a bar on the plan, or use this form. Payout batches and the announcement keep their dates."}
        </p>
      </section>

      <details className="plan-details">
        <summary>Every task as a list ({tasks.length})</summary>
        <div className="plan-table-wrap">
          <table className="plan-table">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Kind</th>
                <th scope="col">Starts</th>
                <th scope="col" className="num">
                  Days
                </th>
                <th scope="col" className="num">
                  Done
                </th>
                <th scope="col">Added by</th>
              </tr>
            </thead>
            <tbody>
              {[...tasks]
                .sort((a, b) => a.startDate.localeCompare(b.startDate))
                .map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{KIND_WORD[t.kind] ?? t.kind}</td>
                    <td className="tabular">{dayShort(t.startDate)}</td>
                    <td className="num tabular">{t.duration}</td>
                    <td className="num tabular">{Math.round(t.percentDone)}%</td>
                    <td>{SOURCE_WORD[t.source] ?? t.source}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className="firm-section" aria-labelledby="sched-h">
        <h2 id="sched-h" className="firm-h2">
          Review schedule <FirmInfo id="firm.scheduler" label="" />
        </h2>
        <p className="muted">
          {data.schedule.events.filter((e) => e.status === "open").length} open {data.schedule.events.filter((e) => e.status === "open").length === 1 ? "review" : "reviews"}, each
          answered within {data.schedule.hours} hours. Ana and Devon are sample reviewers.
        </p>
        <div className="plan-sched" ref={schedBox}>
          <BryntumScheduler
            readOnly
            autoHeight
            startDate={sched.start}
            endDate={sched.end}
            viewPreset="dayAndWeek"
            rowHeight={56}
            barMargin={8}
            columns={[{ text: "Reviewer", field: "name", width: 150 }]}
            resources={data.schedule.resources as never}
            events={
              data.schedule.events.map((e) => ({
                ...e,
                startDate: new Date(e.startDate),
                endDate: new Date(e.endDate),
              })) as never
            }
            eventDragFeature={false}
            eventResizeFeature={false}
            eventEditFeature={false}
            eventMenuFeature={false}
            scheduleMenuFeature={false}
            cellMenuFeature={false}
            headerMenuFeature={false}
            eventDragCreateFeature={false}
            eventTooltipFeature={{
              template: ({ eventRecord }: { eventRecord: { name: string; note?: string } }) =>
                `<div class="plan-tip"><b>${escapeHtml(eventRecord.name)}</b><br>${escapeHtml(eventRecord.note ?? "")}</div>`,
            }}
            timeRangesFeature={{ showCurrentTimeLine: true }}
          />
        </div>
      </section>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
