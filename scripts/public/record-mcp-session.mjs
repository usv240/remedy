// Records the tool calls an AI assistant makes to help an owner with a recall, against Remedy's own MCP server
// (/api/mcp), and writes content/public/mcp-session.json for /developers. Each call is a real JSON-RPC request to the
// running server: find the recall, read its proof rule, get the owner's claim link, open the claim with the owner's
// photo, and follow it. No AI model is called to record it: the assistant's turns are not part of the file, only its
// tool calls and the server's answers. The photo is Brightline's published sample photo (public domain), checked by
// the real verifier and answered by the verification cache, so no model runs on the server either (start the server
// with ANTHROPIC_API_KEY= to be sure). The claim it opens is removed afterwards unless --keep.
//
//   BASE_URL=http://localhost:3300 node --env-file=.env.local scripts/public/record-mcp-session.mjs [--keep]
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const B = (process.env.BASE_URL ?? "http://localhost:3300").replace(/\/$/, "");
const keep = process.argv.includes("--keep");
const PHOTO = "public/samples/charger/cord-cut.jpg";

let id = 0;
async function rpc(method, params) {
  const t0 = performance.now();
  const r = await fetch(`${B}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "Mcp-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return { result: j.result, ms: Math.round(performance.now() - t0) };
}

/** The server's own address becomes {origin}, so the page shows the links as its own server would give them. */
const scrub = (v) => JSON.parse(JSON.stringify(v).split(B).join("{origin}"));

async function main() {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "remedy-session-recorder", version: "1" } });
  const list = await rpc("tools/list", {});
  const steps = [];
  const call = async (why, name, args, shownArgs = args) => {
    const { result, ms } = await rpc("tools/call", { name, arguments: args });
    const text = result.content?.map((c) => c.text).join("\n") ?? "";
    steps.push({ why, tool: name, arguments: scrub(shownArgs), text: scrub(text), isError: Boolean(result.isError), ms });
    console.log(`${name} (${ms} ms): ${text.slice(0, 140).replace(/\n/g, " ")}`);
    return result;
  };

  await call("Find the recall from the owner's own words.", "search_recalls", { query: "Brightline 65W laptop charger", limit: 3 });
  await call("Read what the recall asks the owner to do and photograph.", "get_proof_rule", { recall_number: "BH-2026-01" });
  await call("Give the owner their own claim link and checklist. Nothing is opened yet.", "open_claim", { recall_number: "BH-2026-01" });
  const b64 = readFileSync(PHOTO).toString("base64");
  const opened = await call("The owner has cut the cord and sends one photo: open the claim, which runs the six checks.", "open_claim", { recall_number: "BH-2026-01", image_base64: b64 }, { recall_number: "BH-2026-01", image_base64: `<the owner's photo: ${PHOTO}, ${Math.round(readFileSync(PHOTO).length / 1024)} KB>` });
  const claimId = opened.structuredContent?.id;
  if (!claimId) throw new Error("open_claim did not return a claim id");
  await call("Follow the claim to its decision and payment.", "claim_status", { claim_id: claimId });

  const out = {
    note: "A recorded session of real MCP tool calls against Remedy's own server (/api/mcp, streamable HTTP), written by scripts/public/record-mcp-session.mjs. These are the tool calls an AI assistant makes to help an owner; no AI model was called to record them, and the claim's photo was answered by the verification cache. {origin} is the server's own address. Demonstration in PayPal sandbox; Brightline Home and its recall are fictional.",
    recordedAt: new Date().toISOString(),
    server: { name: init.result.serverInfo?.name, version: init.result.serverInfo?.version, protocolVersion: init.result.protocolVersion },
    tools: list.result.tools.map((t) => t.name),
    owner: "I got a recall notice for my Brightline laptop charger. What do I do?",
    steps,
  };
  writeFileSync("content/public/mcp-session.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote content/public/mcp-session.json: ${steps.length} tool calls`);

  if (!keep && process.env.DATABASE_URL) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const { rows } = await c.query("select photo_id from claim where id = $1", [claimId]);
    await c.query("delete from plan_task where data->>'claimId' = $1", [claimId]);
    await c.query("delete from claim where id = $1", [claimId]);
    if (rows[0]?.photo_id) {
      await c.query("delete from image_hash where source = 'claim' and ref = $1", [rows[0].photo_id]);
      await c.query("delete from photo where id = $1", [rows[0].photo_id]);
    }
    await c.end();
    console.log("removed the recorded claim (its ledger entries stay)");
  }
}

main().catch((e) => {
  console.error("record-mcp-session failed:", e.message);
  process.exit(1);
});
