import { ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { agencyTier } from "@/lib/recall/agencies";

/**
 * GET /api/try/agencies?q=infant+formula: the second tier of "Find your recall". Asks the FDA (food and drugs) and
 * NHTSA (vehicles and equipment), each best-effort inside its own timeout, and returns their hits labelled by agency.
 * The box calls this only after the CPSC search had no good hit, so the first results never wait on another agency.
 */
export async function GET(req: Request) {
  return guard(req, "GET /api/try/agencies", async () => {
    const started = Date.now();
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 120);
    if (q.length < 3) return ok({ query: q, checked: false, hits: [], agencies: [], ms: 0, note: "" }, started);
    const tier = await agencyTier(q, { mode: "local", hits: [] }, { force: true, timeoutMs: 6000 });
    return ok({ query: q, ...tier }, started);
  });
}
