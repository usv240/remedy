/**
 * A small runner for the Anthropic Message Batches API (half price, asynchronous). It submits the requests, remembers
 * the batch id in a state file so a rerun resumes the same batch instead of paying twice, polls until the batch ends,
 * and returns every result keyed by custom_id. Server-only (scripts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logUsage } from "../ai/usage";

export type BatchItem =
  | { customId: string; ok: true; message: Anthropic.Message }
  | { customId: string; ok: false; error: string };

type State = Record<string, { batchId: string; createdAt: string; count: number; ids: string[] }>;

const readState = (file: string): State => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as State) : {});
const writeState = (file: string, s: State) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 1));
};

export async function runBatch(opts: {
  client: Anthropic;
  /** Name of this batch in the state file, for example "plain". */
  name: string;
  stateFile: string;
  requests: Anthropic.Messages.BatchCreateParams.Request[];
  pollMs?: number;
  log?: (s: string) => void;
}): Promise<{ batchId: string; items: BatchItem[]; resumed: boolean }> {
  const { client, name, stateFile, requests } = opts;
  const log = opts.log ?? ((s: string) => console.log(s));
  const state = readState(stateFile);
  const ids = requests.map((r) => r.custom_id).sort();
  let batchId = state[name]?.batchId;
  const same = batchId && JSON.stringify(state[name].ids) === JSON.stringify(ids);
  let resumed = false;
  if (batchId && same) {
    resumed = true;
    log(`[${name}] resuming batch ${batchId} (${ids.length} requests)`);
  } else {
    const created = await client.messages.batches.create({ requests });
    batchId = created.id;
    state[name] = { batchId, createdAt: new Date().toISOString(), count: requests.length, ids };
    writeState(stateFile, state);
    log(`[${name}] created batch ${batchId} with ${requests.length} requests`);
  }
  const pollMs = opts.pollMs ?? 30_000;
  for (;;) {
    const b = await client.messages.batches.retrieve(batchId);
    const c = b.request_counts;
    log(`[${name}] ${b.processing_status}: processing ${c.processing}, succeeded ${c.succeeded}, errored ${c.errored}, expired ${c.expired}, canceled ${c.canceled}`);
    if (b.processing_status === "ended") break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const items: BatchItem[] = [];
  for await (const res of await client.messages.batches.results(batchId)) {
    const r = res.result;
    if (r.type === "succeeded") {
      items.push({ customId: res.custom_id, ok: true, message: r.message });
      // A resumed batch was already paid for and logged; log only results fetched for a new one.
      if (!resumed) await logUsage({ route: `batch.${name}`, model: r.message.model, effort: null, batch: true, usage: r.message.usage });
    }
    else items.push({ customId: res.custom_id, ok: false, error: r.type === "errored" ? `${r.error.error.type}: ${r.error.error.message}` : r.type });
  }
  return { batchId, items, resumed };
}

/** Run requests directly with a concurrency limit, when batches are not available. Same result shape. */
export async function runDirect(opts: {
  client: Anthropic;
  requests: Anthropic.Messages.BatchCreateParams.Request[];
  concurrency?: number;
  log?: (s: string) => void;
}): Promise<BatchItem[]> {
  const out: BatchItem[] = [];
  const queue = [...opts.requests];
  const worker = async () => {
    for (let req = queue.shift(); req; req = queue.shift()) {
      try {
        const message = await opts.client.messages.create(req.params);
        out.push({ customId: req.custom_id, ok: true, message });
        await logUsage({ route: "direct", model: message.model, effort: null, usage: message.usage });
      } catch (e) {
        out.push({ customId: req.custom_id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      if (out.length % 25 === 0) (opts.log ?? console.log)(`direct: ${out.length}/${opts.requests.length}`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  return out;
}
