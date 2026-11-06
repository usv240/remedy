import type { BatchCreateParams } from "@anthropic-ai/sdk/resources/beta/messages/batches";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AiUnavailableError, aiError, claude, MODEL } from "@/lib/ai/claude";
import { usageOf, VISION_SYSTEM, visionContent, type VisionArgs, type VisionRun } from "./vision";
import { VisionReportSchema } from "./vision-schema";

/**
 * The vision step for many photos at once (the benchmark rerun, re-checking a backlog), through the Message Batches
 * API at half the cost. Owners never wait on this path: a live claim uses runVision.
 *
 * Use: submitVisionBatch(items) returns a batch id; poll visionBatchStatus(id) until it has ended; collectVisionBatch(id)
 * returns each photo's VisionRun by id; then run verifyPhoto(input, { vision: async () => run }) so every decision
 * still goes through the same deterministic checks. Server-side fallbacks are not accepted on batches, so they are left out.
 */

/** Batch custom ids allow letters, digits, _ and -, up to 64 characters. */
export const batchId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

export function visionBatchRequest(id: string, args: VisionArgs): BatchCreateParams.Request {
  const fmt = betaZodOutputFormat(VisionReportSchema);
  return {
    custom_id: batchId(id),
    params: {
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: VISION_SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: args.effort ?? "medium", format: { type: "json_schema", schema: fmt.schema } },
      messages: [{ role: "user", content: visionContent(args) }],
    },
  };
}

export async function submitVisionBatch(items: { id: string; args: VisionArgs }[]): Promise<string> {
  const c = claude();
  if (!c) throw new AiUnavailableError();
  const ids = new Set(items.map((i) => batchId(i.id)));
  if (ids.size !== items.length) throw new Error("Batch ids must be unique after cleaning.");
  const batch = await c.beta.messages.batches.create({ requests: items.map((i) => visionBatchRequest(i.id, i.args)) }).catch((e: unknown) => {
    throw aiError(e);
  });
  return batch.id;
}

export async function visionBatchStatus(id: string) {
  const c = claude();
  if (!c) throw new AiUnavailableError();
  const b = await c.beta.messages.batches.retrieve(id);
  return { status: b.processing_status, counts: b.request_counts };
}

/** Results by custom id: a VisionRun, or the reason there is none. Results arrive in any order. */
export async function collectVisionBatch(id: string): Promise<Map<string, VisionRun | { error: string }>> {
  const c = claude();
  if (!c) throw new AiUnavailableError();
  const out = new Map<string, VisionRun | { error: string }>();
  for await (const line of await c.beta.messages.batches.results(id)) {
    if (line.result.type !== "succeeded") {
      out.set(line.custom_id, { error: line.result.type === "errored" ? `errored: ${line.result.error.error.message}` : line.result.type });
      continue;
    }
    const msg = line.result.message;
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      out.set(line.custom_id, { error: msg.stop_reason === "refusal" ? "refusal" : "no JSON in the reply" });
      continue;
    }
    const r = VisionReportSchema.safeParse(parsed);
    out.set(line.custom_id, r.success ? { report: r.data, model: msg.model, ms: 0, usage: usageOf(msg.usage) } : { error: `schema: ${r.error.message.slice(0, 200)}` });
  }
  return out;
}
