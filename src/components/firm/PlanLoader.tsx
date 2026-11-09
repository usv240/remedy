"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { ensureBryntumScript, ensureBryntumTheme } from "@/components/gantt/bryntum";
import { dayShort } from "@/lib/firm/dates";
import type { GanttTask } from "@/lib/firm/plan";
import type { PlanData } from "./PlanGantt";

/**
 * The plan runs only in the browser: Bryntum's theme goes on first, then its UMD script from /bryntum/gantt.umd.js
 * (5.8 MB, kept out of the bundle, scripts/vendor-bryntum.mjs), then the component that uses it. Until the chart is
 * ready, and for good if the script cannot load, the plan's tasks show as a plain list, rendered on the server with the
 * page, so the panel is never empty: a slow phone, a blocked script or a reader without scripts still sees the plan.
 * The chart mounts behind the list, hidden and inert, and the two swap only once its task bars are drawn (onReady), so
 * there is never an empty grid on screen.
 */
type Gantt = ComponentType<{ data: PlanData; onReady?: () => void }>;
type State = "loading" | "slow" | "failed";

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
      {!ready && <PlanList data={data} state={state} retry={() => (setState("loading"), setAttempt((n) => n + 1))} />}
      {Chart && (
        <div className="plan-stage-chart" inert={!ready}>
          <Chart data={data} onReady={onReady} />
        </div>
      )}
    </div>
  );
}

/** The plan's tasks in date order, with what the chart is doing. Also what a reader without scripts gets. */
function PlanList({ data, state, retry }: { data: PlanData; state: State; retry: () => void }) {
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
