"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { ensureBryntumScript, ensureBryntumTheme } from "@/components/gantt/bryntum";
import { dayShort } from "@/lib/firm/dates";
import type { GanttTask } from "@/lib/firm/plan";
import type { PlanData } from "./PlanGantt";

/**
 * The plan runs only in the browser: Bryntum's theme goes on first, then its UMD script from /bryntum/gantt.umd.js
 * (5.8 MB, kept out of the bundle, scripts/vendor-bryntum.mjs), then the component that uses it. While it loads, a
 * skeleton of the chart holds its place: the same rows, columns and scale, each task a flat bar at its real dates, so
 * nothing moves when the chart arrives. A reader without scripts gets the plan's tasks as a plain list instead
 * (<noscript>), and so does anyone whose chart is slow to open or cannot load, with a way to try again. The chart mounts
 * behind, hidden and inert, and takes over once its task bars are drawn (onReady).
 */
type Gantt = ComponentType<{ data: PlanData; onReady?: () => void }>;
type State = "loading" | "slow" | "failed";
const DAY = 86_400_000;
/** The chart's own scale and sizes (PlanGantt: weekAndDayLetter, rowHeight 40, the three grid columns). */
const PX_PER_DAY = 20;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const SLOW_MS = 12_000;
const flat = (tasks: GanttTask[]): GanttTask[] => tasks.flatMap((t) => [...(t.kind === "group" ? [] : [t]), ...flat(t.children ?? [])]);

export function PlanLoader({ data }: { data: PlanData }) {
  const [Chart, setChart] = useState<Gantt | null>(null);
  const [state, setState] = useState<State>("loading");
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    let alive = true;
    const slow = window.setTimeout(() => alive && setState((s) => (s === "loading" ? "slow" : s)), SLOW_MS);
    ensureBryntumTheme()
      .then(ensureBryntumScript)
      .then(() => import("./PlanGantt"))
      .then((m) => alive && setChart(() => m.PlanGantt))
      .catch(() => alive && setState("failed"));
    return () => {
      alive = false;
      window.clearTimeout(slow);
    };
  }, [attempt]);

  return (
    <div className="plan-stage" data-ready={ready ? "" : undefined}>
      {!ready &&
        (state === "loading" ? (
          <>
            <PlanSkeleton data={data} />
            <noscript>
              <style>{".plan-skel{display:none}"}</style>
              <PlanList data={data} state="static" retry={() => {}} />
            </noscript>
          </>
        ) : (
          <PlanList data={data} state={state} retry={() => (setState("loading"), setAttempt((n) => n + 1))} />
        ))}
      {Chart && (
        <div className="plan-stage-chart" inert={!ready}>
          <Chart data={data} onReady={onReady} />
        </div>
      )}
    </div>
  );
}

/** The rows the chart opens with: each group, then its tasks when it is open; a closed group is one row. */
type Row = { t: GanttTask; depth: number; start: string; end: string };
function span(t: GanttTask): { start: string; end: string } {
  if (!t.children?.length) return { start: t.startDate, end: addDays(t.startDate, Math.max(Math.ceil(t.duration), 0)) };
  const all = t.children.map(span);
  return { start: all.map((x) => x.start).sort()[0], end: all.map((x) => x.end).sort().at(-1)! };
}
const visibleRows = (tasks: GanttTask[], depth = 0): Row[] => tasks.flatMap((t) => [{ t, depth, ...span(t) }, ...(t.children && t.expanded !== false ? visibleRows(t.children, depth + 1) : [])]);

/**
 * The chart's place while it loads: its header, then each row it will draw, with flat bars where the names, dates and
 * task bars will be, at the chart's own scale from the same start. No shimmer; hidden from screen readers, which hear
 * the status line instead.
 */
function PlanSkeleton({ data }: { data: PlanData }) {
  const rows = visibleRows(data.tasks);
  const start = addDays(data.recall.announced, -3);
  return (
    <div className="plan-skel" data-testid="plan-skeleton">
      <p className="sr-only" role="status">
        Opening the chart of the plan&rsquo;s {flat(data.tasks).length} tasks.
      </p>
      <div className="plan-skel-grid" aria-hidden="true">
        <div className="plan-skel-head">
          <span className="plan-skel-col-name">Task</span>
          <span className="plan-skel-col-start">Start</span>
          <span className="plan-skel-col-days">Days</span>
        </div>
        <div className="plan-skel-head plan-skel-head-time" />
        {rows.map(({ t, depth, start: s, end: e }) => (
          <div key={t.id} className="plan-skel-row" data-group={t.kind === "group" ? "" : undefined}>
            <span className="plan-skel-cell plan-skel-col-name">
              <span className="plan-skel-bar" style={{ marginLeft: depth * 16, width: `min(${Math.max(6, Math.min(t.name.length, 34)) * 0.5}rem, 88%)` }} />
            </span>
            <span className="plan-skel-cell plan-skel-col-start">
              <span className="plan-skel-bar" style={{ width: "2.75rem" }} />
            </span>
            <span className="plan-skel-cell plan-skel-col-days">
              <span className="plan-skel-bar" style={{ width: "2.25rem" }} />
            </span>
            <span className="plan-skel-track">
              <span
                className="plan-skel-task"
                data-kind={t.kind === "announcement" ? "milestone" : t.kind === "group" ? "group" : undefined}
                style={{ left: daysFrom(start, s) * PX_PER_DAY, width: t.kind === "announcement" ? 14 : Math.max(daysFrom(s, e) * PX_PER_DAY, 10) }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The plan's tasks in date order, with what the chart is doing. Also what a reader without scripts gets. */
function PlanList({ data, state, retry }: { data: PlanData; state: State | "static"; retry: () => void }) {
  const tasks = flat(data.tasks).sort((a, b) => a.startDate.localeCompare(b.startDate));
  return (
    <div className="plan-fallback" data-testid="plan-fallback" role="region" aria-label="The plan's tasks" tabIndex={0}>
      <p className="plan-fallback-status" role="status" aria-live="polite">
        {state === "failed" ? (
          <>
            The chart could not open here, so the plan&rsquo;s {tasks.length} tasks are listed below.{" "}
            <button type="button" className="cl-textbtn" onClick={retry}>
              Try the chart again
            </button>
          </>
        ) : state === "slow" ? (
          <>Opening the chart is taking a while on this connection. The plan&rsquo;s {tasks.length} tasks are below in the meantime.</>
        ) : state === "static" ? (
          <>The plan&rsquo;s {tasks.length} tasks, in date order:</>
        ) : (
          <>Opening the chart. The plan&rsquo;s {tasks.length} tasks, in date order:</>
        )}
      </p>
      <ol className="plan-fallback-list">
        {tasks.map((t) => (
          <li key={t.id}>
            <span className="plan-fallback-name">{t.name}</span>
            <span className="tabular muted">
              {dayShort(t.startDate)}
              {t.duration ? `, ${t.duration} ${t.duration === 1 ? "day" : "days"}` : ""}
              {t.percentDone >= 100 ? ", done" : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
