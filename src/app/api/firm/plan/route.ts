import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { ctxOr, jsonBody, reviewerName } from "@/lib/firm/api";
import { isoDay } from "@/lib/firm/dates";
import { toGantt } from "@/lib/firm/plan";
import { ensureBasePlan, moveTask, planRows, reviewSchedule } from "@/lib/firm/plan-data";

/** GET /api/firm/plan: the corrective-action plan (Bryntum Gantt tasks and dependencies) and the review schedule. */
export async function GET() {
  const started = Date.now();
  const got = await ctxOr();
  if ("error" in got) return got.error;
  await ensureBasePlan(got.ctx.firm, got.recall);
  const rows = await planRows(got.ctx.firm, got.recall.number);
  const today = isoDay(new Date());
  return ok({ recall: { number: got.recall.number, short: got.recall.short, announced: got.recall.announced }, today, ...toGantt(rows, today), schedule: await reviewSchedule(got.ctx.firm) }, started, {
    tasks: rows.length,
  });
}

/** POST /api/firm/plan { id, start, duration_days?, by? }: move a task (the form and keyboard alternative to a drag). */
export async function POST(req: Request) {
  return guard(req, "firm.plan.move", async () => {
    const started = Date.now();
    const got = await ctxOr();
    if ("error" in got) return got.error;
    const body = await jsonBody<{ id?: unknown; start?: unknown; duration_days?: unknown; by?: unknown }>(req);
    const id = Number(body?.id);
    if (!Number.isInteger(id) || typeof body?.start !== "string") return fail("invalid_request", "Choose a task and a start date.", 400);
    const r = await moveTask(got.ctx.firm, id, { start: body.start, durationDays: typeof body.duration_days === "number" ? body.duration_days : undefined, by: reviewerName(body.by) });
    if (!r.ok) return fail("invalid_request", r.plain, 409);
    return ok(r.row, started);
  });
}
