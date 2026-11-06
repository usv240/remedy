// The public side of a running Remedy: recall search relevance, the explorer and one recall's page, the public API
// with and without a key, and the MCP tools listed and answering. No AI call: verify runs without a key (free checks),
// and the MCP verify_photo case is the recall's own picture, which is settled before any model call.
// Usage: BASE_URL=http://localhost:3300 node tests/e2e/public.mjs
import { readFileSync } from "node:fs";

const B = process.env.BASE_URL ?? "http://localhost:3300";
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
};
/** Page text with React's <!-- --> separators removed, so a sentence can be matched whole. */
const page = async (path) => (await (await fetch(B + path)).text()).replace(/<!-- -->/g, "");
/** A JSON call, with the run's key unless the call sets its own Authorization or asks for { anon: true }. */
let key = null;
const json = async (path, init = {}, o = {}) => {
  const headers = { ...(init.headers ?? {}) };
  if (key && !o.anon && !headers.Authorization) headers.Authorization = `Bearer ${key}`;
  let r = await fetch(B + path, { ...init, headers });
  // A shared dev machine: other test runs can use up the demo tier's minute. Wait it out once, then try again.
  const wait = Number(r.headers.get("retry-after"));
  if (r.status === 429 && wait > 0 && wait <= 60 && !o.noRetry) {
    await new Promise((res) => setTimeout(res, wait * 1000 + 500));
    r = await fetch(B + path, { ...init, headers });
  }
  return { r, j: await r.json().catch(() => null) };
};

// One sandbox key for the run (60 requests a minute), so the demo tier's 20 a minute is never the limit. REMEDY_KEY
// reuses one (new keys are limited to 5 a day per client); otherwise one is made. If none can be made, the calls use
// the demo tier and wait out its limit.
if (process.env.REMEDY_KEY) {
  key = process.env.REMEDY_KEY;
} else {
  const made = await json("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "e2e public", email: `e2e-public+${Date.now()}@example.com`, purpose: "tests/e2e/public.mjs", accept: true }) }, { noRetry: true });
  key = made.j?.data?.key ?? null;
  if (made.r.status === 429) console.log(`note: no new key today (${made.j?.error?.message ?? "limit"}); set REMEDY_KEY to reuse one. Using the demo tier.`);
  else check("a sandbox key is issued once, rm_test_ plus 43 characters", /^rm_test_[0-9A-Za-z]{43}$/.test(key ?? ""), key ? "" : `${made.r.status} ${made.j?.error?.message ?? ""}`);
}

// 1. Search relevance: four plain-language queries, the right kind of product at the top.
const QUERIES = [
  { q: "power bank", top: 3, want: (h) => h.number === "27056", say: "27056 HAIARA power banks in the top 3" },
  { q: "space heater", top: 3, want: (h) => h.category === "Heaters", say: "every one of the top 3 is a heater", every: true },
  { q: "pajama set", top: 5, want: (h) => h.category === "Sleepwear and clothing", say: "every one of the top 5 is sleepwear", every: true },
  { q: "nursing pillow", top: 3, want: (h) => /nursing pillow/i.test(h.product_names.join(" ")), say: "every one of the top 3 is a nursing pillow", every: true },
];
for (const t of QUERIES) {
  const { r, j } = await json(`/api/v1/recalls?query=${encodeURIComponent(t.q)}&limit=${t.top}`);
  const hits = j?.data?.hits ?? [];
  const ok = r.status === 200 && hits.length > 0 && (t.every ? hits.every(t.want) : hits.some(t.want));
  check(`search "${t.q}": ${t.say}`, ok, `${j?.meta?.search?.mode ?? "?"}: ${hits.map((h) => h.number).join(" ")}`);
}
{
  const { j } = await json("/api/v1/recalls?query=pajama%20set&photo_refund=true&limit=10");
  check("search with photo_refund=true returns only photo-refund recalls, each with its rule", (j?.data?.hits ?? []).length > 0 && j.data.hits.every((h) => h.photo_refund && h.proof_rule), `${j?.data?.hits?.length} hits`);
  const list = await json("/api/v1/recalls?photo_refund=true&year=2026&limit=2");
  check("list mode: photo-refund recalls in 2026, newest first", list.j?.meta?.search?.mode === "list" && list.j.data.total > 200 && list.j.data.hits[0].date >= list.j.data.hits[1].date, `total ${list.j?.data?.total}`);
}

// 2. Pages: the explorer, a filtered view, one recall, an unknown recall.
{
  const html = await page("/recalls");
  check("explorer /recalls lists 20 recalls with Show more", (html.match(/class="rx-mcard"/g) ?? []).length === 20 && html.includes("Show 20 more"));
  const more = await (await fetch(`${B}/recalls?show=40`)).text();
  check("Show more: /recalls?show=40 lists 40", (more.match(/class="rx-mcard"/g) ?? []).length === 40);
  const q = await (await fetch(`${B}/recalls?query=space%20heater&photo_refund=true`)).text();
  check("explorer search with the photo-refund card", q.includes("Showing") && /aria-current="true"[^>]*>\s*<span class="rx-card-k">Photo refund/.test(q.replace(/<!-- -->/g, "")));
  const d = await fetch(`${B}/recalls/27056`);
  const dh = await d.text();
  check("recall 27056: proof rule, official remedy quoted, images credited, Start a claim", d.status === 200 && dh.includes('id="rule"') && dh.includes("permanent marker") && dh.includes("Images: U.S. Consumer Product Safety Commission") && dh.includes('href="/claim/27056"'));
  check("recall 27056: confidence per field, and the Technical trace in the page", /\d{2}%/.test(dh) && dh.includes("Behind this rule") && dh.includes("RecallNumber"));
  const nf = await page("/recalls/99999");
  check("an unknown recall says so plainly", nf.includes("We could not find recall 99999"));
}

// 3. The API, without a key, with a bad key, and with a real one.
{
  const a = await json("/api/v1/recalls/27056", {}, { anon: true });
  check("GET /api/v1/recalls/27056 without a key", a.r.status === 200 && a.j?.data?.proof_rule?.actions?.includes("write_recalled") && a.j?.error === null && a.r.headers.get("x-ratelimit-limit") === "20");
  const bad = await json("/api/v1/recalls/27056", { headers: { Authorization: "Bearer rm_test_notarealkey" } });
  check("a key that is not valid gets 401 with a plain message", bad.r.status === 401 && bad.j?.error?.code === "unauthorized");
  const nf = await json("/api/v1/recalls/99999");
  check("an unknown recall is a 404 not_found", nf.r.status === 404 && nf.j?.error?.code === "not_found");

  if (key) {
    const k = await json("/api/v1/recalls?query=power%20bank&limit=1");
    check("with a key: 60 a minute", k.r.status === 200 && k.r.headers.get("x-ratelimit-limit") === "60");
  }

  const rule = await json("/api/v1/proof-rule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recall_number: "27056" }) });
  check("POST /api/v1/proof-rule {recall_number}: the stored rule", rule.r.status === 200 && rule.j?.data?.source === "stored" && rule.j.data.rule.marker_text?.toLowerCase() === "recalled");
  const quick = await json("/api/v1/proof-rule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remedy_text: "Consumers should cut the power cord and email a photo of the destroyed product to receive a full refund." }) });
  check("POST /api/v1/proof-rule {remedy_text}: the quick read, no AI", quick.r.status === 200 && quick.j?.data?.source === "quick" && quick.j.data.rule.actions.includes("cut_cord"));
  const both = await json("/api/v1/proof-rule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  check("POST /api/v1/proof-rule with neither field is a 422", both.r.status === 422 && both.j?.error?.code === "invalid_request");
  const noKeyClaude = await json("/api/v1/proof-rule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remedy_text: "Consumers should cut the cord and email a photo for a full refund.", mode: "claude" }) }, { anon: true });
  check('mode "claude" without a key is a 401, and costs nothing', noKeyClaude.r.status === 401);

  const form = new FormData();
  form.append("photo", new Blob([readFileSync("content/verify/fixtures/official/27056-haiara-1.jpg")], { type: "image/jpeg" }), "photo.jpg");
  form.append("recall_number", "27056");
  const v = await json("/api/v1/verify", { method: "POST", body: form }, { anon: true });
  check("POST /api/v1/verify with the recall's own picture: retake, own photo, free checks", v.r.status === 200 && v.j?.data?.decision === "retake" && v.j.data.decided_by === "own_photo" && v.j.data.mode === "free" && v.j.data.payment === null, `${v.j?.data?.timings?.total_ms} ms`);
  const noPhoto = new FormData();
  noPhoto.append("recall_number", "27056");
  const np = await json("/api/v1/verify", { method: "POST", body: noPhoto });
  check("POST /api/v1/verify with no photo is a 400 with a plain message", np.r.status === 400 && /photo/i.test(np.j?.error?.message ?? ""));
}

// The claim routes under their public /api/v1 names: the same handlers as /api/claims.
{
  const bad = await json("/api/v1/claims/not-a-claim-id");
  check("GET /api/v1/claims/{id} is served (a malformed id is a plain 400)", bad.r.status === 400 && bad.j?.error?.code === "invalid_request");
  const none = await json("/api/v1/claims/00000000-0000-4000-8000-000000000000");
  check("GET /api/v1/claims/{id} for a claim that does not exist is a 404", none.r.status === 404 && none.j?.error?.code === "not_found");
}

// 4. OpenAPI, docs and discovery.
{
  const { j } = await json("/openapi.json");
  check("openapi.json describes the v1 endpoints", ["/api/v1/recalls", "/api/v1/recalls/{number}", "/api/v1/proof-rule", "/api/v1/verify"].every((p) => j?.paths?.[p]));
  const docs = await (await fetch(`${B}/developers/docs`)).text();
  check("docs: fields, recorded responses and the MCP section", docs.includes("Recorded response") && docs.includes('id="mcp"') && docs.includes("recall_number"));
  const llms = await (await fetch(`${B}/llms.txt`)).text();
  check("llms.txt lists the tools and the API", ["search_recalls", "get_proof_rule", "verify_photo", "open_claim", "claim_status", "/api/v1/verify"].every((s) => llms.includes(s)));
}

// 5. MCP: listed and answering.
{
  const rpc = (method, params = {}) => json("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.j);
  const list = await rpc("tools/list");
  const names = (list?.result?.tools ?? []).map((t) => t.name);
  check("MCP tools/list: the five tools and ping", ["search_recalls", "get_proof_rule", "verify_photo", "open_claim", "claim_status", "ping"].every((n) => names.includes(n)), names.join(" "));
  const s = await rpc("tools/call", { name: "search_recalls", arguments: { query: "space heater", limit: 3 } });
  check("MCP search_recalls answers", !s?.result?.isError && s?.result?.structuredContent?.hits?.length === 3);
  const g = await rpc("tools/call", { name: "get_proof_rule", arguments: { recall_number: "27045" } });
  check("MCP get_proof_rule: cut the pajamas in half", !g?.result?.isError && g?.result?.structuredContent?.rule?.actions?.includes("cut_in_half"));
  const b64 = readFileSync("content/verify/fixtures/official/27056-haiara-1.jpg").toString("base64");
  const v = await rpc("tools/call", { name: "verify_photo", arguments: { recall_number: "27056", image_base64: b64 } });
  check("MCP verify_photo: the recall's own picture asks for the owner's photo", v?.result?.structuredContent?.decision === "retake");
  const o = await rpc("tools/call", { name: "open_claim", arguments: { recall_number: "27056" } });
  check("MCP open_claim with a recall number: the owner's own claim link", o?.result?.structuredContent?.claim_link?.endsWith("/claim/27056"));
  const bad = await rpc("tools/call", { name: "get_proof_rule", arguments: {} });
  check("MCP: arguments that do not fit are a plain error", bad?.result?.isError === true);
}

console.log(failed ? `\n${failed} checks failed` : "\nall public checks pass");
process.exitCode = failed ? 1 : 0;
