import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { recallByNumber, storedRule } from "@/lib/api/recall-data";
import { ProofRuleRequest, VERIFY_LIMITS } from "@/lib/api/v1-schemas";
import { callsToday, keyIdFor } from "@/lib/api/verify-service";
import { logUsage, overBudget } from "@/lib/ai/usage";
import { log } from "@/lib/log";
import { extractBaseline, extractWithClaude, lintRule } from "@/lib/recall/proof-rule";

/**
 * POST /api/v1/proof-rule
 *  { recall_number }  the stored rule for a CPSC recall (Claude Opus 5.5 with a self-check, extracted in a batch).
 *  { remedy_text }    a rule read from any remedy text: the deterministic quick reader by default, or Claude with
 *                     mode "claude" (needs a key; at most VERIFY_LIMITS.claudeRulesPerKeyPerDay a day).
 */
export async function POST(req: Request) {
  const body = await req
    .clone()
    .json()
    .catch(() => null);
  const claude = body && typeof body === "object" && (body as { mode?: unknown }).mode === "claude";
  return guard(req, claude ? "v1.proof-rule.claude" : "v1.proof-rule", async () => {
    const started = Date.now();
    if (!body) return fail("invalid_request", "The request body must be JSON, for example { \"recall_number\": \"27056\" }.", 400);
    const parsed = ProofRuleRequest.safeParse(body);
    if (!parsed.success) return fail("invalid_request", parsed.error.issues[0]?.message ?? "The request is not valid.", 422, parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    const b = parsed.data;

    if (b.recall_number) {
      const recall = recallByNumber(b.recall_number);
      if (!recall) return fail("not_found", `There is no recall ${b.recall_number} in Remedy's data. Send its remedy_text instead.`, 404);
      const stored = storedRule(recall.number);
      if (stored) {
        return ok({ recall: { number: recall.number, title: recall.title }, rule: stored.rule, source: "stored", model: stored.model, extracted_at: stored.extractedAt, method: stored.method, lint: lintRule(stored.rule, recall) }, started);
      }
      const rule = extractBaseline(recall);
      return ok({ recall: { number: recall.number, title: recall.title }, rule, source: "quick", model: null, note: "No stored rule for this recall yet, so this is the quick read: deterministic keyword rules, no AI.", lint: lintRule(rule, recall) }, started);
    }

    const r = { number: "custom", title: "", remedyText: b.remedy_text!, consumerContact: b.consumer_contact ?? "" };
    if (b.mode !== "claude") {
      const rule = extractBaseline(r);
      return ok({ rule, source: "quick", model: null, note: 'Quick read: deterministic keyword rules, no AI. Send mode "claude" with an API key for Claude\'s reading.', lint: lintRule(rule, r) }, started);
    }

    const keyId = await keyIdFor(req);
    if (!keyId) return fail("unauthorized", 'mode "claude" needs an API key. Get a free one on the Developers page, or leave mode out for the quick read.', 401);
    if (!process.env.ANTHROPIC_API_KEY) return fail("upstream_unavailable", "The AI service is not connected on this server. Leave mode out for the quick read.", 503);
    if ((await callsToday(keyId, "v1.proof-rule.claude")) >= VERIFY_LIMITS.claudeRulesPerKeyPerDay) {
      return fail("rate_limited", `This key has asked Claude for ${VERIFY_LIMITS.claudeRulesPerKeyPerDay} rules today. Leave mode out for the quick read, or try again tomorrow.`, 429);
    }
    if ((await overBudget().catch(() => ({ over: false }))).over) return fail("upstream_unavailable", "Today's AI budget for this site is used up. Leave mode out for the quick read.", 503);
    try {
      const out = await extractWithClaude(r, { selfCheck: true });
      await logUsage({ route: "recall.proof_rule.api", model: out.model, effort: "medium", usage: out.usage as never });
      return ok({ rule: out.rule, draft: out.draft ?? null, source: "claude", model: out.model, method: "Claude Opus 5.5, structured output at medium effort, then a self-check pass.", lint: lintRule(out.rule, r) }, started);
    } catch (e) {
      log.error("v1.proof-rule claude failed", { error: e });
      const rule = extractBaseline(r);
      return ok({ rule, source: "quick", model: null, note: "Claude did not answer just now, so this is the quick read.", lint: lintRule(rule, r) }, started);
    }
  });
}
