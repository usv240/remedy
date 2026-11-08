import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { sampleFirmOf } from "@/lib/recall/label";
import { lookupAnyRecall } from "../_lib/any-recall";

/**
 * GET /api/try/recall?q=27056 (or a cpsc.gov recall URL): the recall and its proof rule. `&download=1` returns the same
 * as a JSON file.
 */
export async function GET(req: Request) {
  return guard(req, "GET /api/try/recall", async () => {
    const started = Date.now();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").slice(0, 400);
    const r = await lookupAnyRecall(q);
    if (!r.found) return fail("not_found", r.message, 404);
    if (url.searchParams.get("download") === "1") {
      const body = {
        recall: {
          number: r.recall.number,
          title: r.recall.title,
          date: r.recall.date,
          product: r.recall.product,
          hazard: r.recall.hazardFull,
          remedy_text: r.recall.remedyText,
          units: r.recall.unitsText,
          url: r.recall.url,
          photo_refund: r.recall.photoRefund,
        },
        proof_rule: r.recall.rule,
        proof_rule_source:
          r.recall.ruleSource === "ai"
            ? `Claude (${r.recall.ruleModel}), extracted from the remedy text and stored`
            : r.recall.ruleSource === "firm"
              ? `Written by hand by ${sampleFirmOf(r.recall.number) ?? "the sample firm"}, a fictional sample firm, no model`
              : "Quick read: Remedy's deterministic keyword rules, no model",
        source: r.recall.sample ? `${sampleFirmOf(r.recall.number) ?? "The sample firm"}'s fictional sample recall (content/recalls/samples.json), not a CPSC recall` : r.from === "list" ? "Remedy's list of CPSC recalls since January 2024" : "CPSC Recalls API, fetched live",
        credit: r.recall.sample
          ? "Sample recall; fictional. Photos: one real charger before and after its cord was cut, by Dmitry G, Wikimedia Commons, public domain (brand marks removed)."
          : "Recall data and images: US Consumer Product Safety Commission (cpsc.gov), public domain.",
      };
      return new Response(JSON.stringify(body, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="remedy-recall-${r.recall.number}.json"` },
      });
    }
    return ok(r, started);
  });
}
