import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanLoader } from "@/components/firm/PlanLoader";
import type { PlanData } from "@/components/firm/PlanGantt";

/**
 * /firm/plan is never an empty panel: the server renders the plan's tasks as a plain list in the chart's place, so a
 * slow connection, a blocked script or a reader without scripts sees the plan; the Gantt replaces the list once its
 * 5.8 MB script has loaded in the browser.
 */
const data: PlanData = {
  recall: { number: "BH-2026-01", short: "Sample charger", announced: "2026-10-15" },
  today: "2026-11-09",
  tasks: [
    { id: 1, name: "Sample recall announced", startDate: "2026-10-15", duration: 0, durationUnit: "day", percentDone: 100, kind: "announcement", source: "seed", note: "", readOnly: true },
    {
      id: "g-follow",
      name: "Follow-up",
      startDate: "2026-11-01",
      duration: 1,
      durationUnit: "day",
      percentDone: 0,
      kind: "group",
      source: "group",
      note: "Follow-up",
      readOnly: true,
      children: [{ id: 7, name: "Re-notice: payout waiting to be accepted", startDate: "2026-11-02", duration: 2, durationUnit: "day", percentDone: 0, kind: "re_notice", source: "webhook", note: "", readOnly: false }],
    },
  ],
  dependencies: [],
  schedule: { resources: [], events: [], hours: 48 },
};

describe("the recall plan before the chart opens", () => {
  it("renders every task as a list on the server, in date order, with no empty loading panel", () => {
    const html = renderToString(createElement(PlanLoader, { data }));
    expect(html).toContain('data-testid="plan-fallback"');
    expect(html).toContain("Sample recall announced");
    expect(html).toContain("Re-notice: payout waiting to be accepted");
    expect(html.indexOf("Sample recall announced")).toBeLessThan(html.indexOf("Re-notice"));
    // Groups are headings in the chart, not tasks.
    expect(html).not.toContain(">Follow-up<");
    expect(html.replace(/<!-- -->/g, "")).toContain("2 tasks");
    expect(html).not.toMatch(/Loading the plan/);
  });
});
