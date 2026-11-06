"use client";

import dynamic from "next/dynamic";
import { ensureBryntumScript, ensureBryntumTheme } from "@/components/gantt/bryntum";

/**
 * The plan runs only in the browser. Bryntum's theme goes on first, then its UMD script from /bryntum/gantt.umd.js
 * (kept out of the bundle, scripts/vendor-bryntum.mjs), then the component that uses it.
 */
export const PlanLoader = dynamic(() => ensureBryntumTheme().then(ensureBryntumScript).then(() => import("./PlanGantt").then((m) => m.PlanGantt)), {
  ssr: false,
  loading: () => (
    <div className="plan-gantt">
      <p className="plan-loading">Loading the plan&hellip;</p>
    </div>
  ),
});
