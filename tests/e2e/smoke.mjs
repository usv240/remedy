// Every page and public endpoint of a running Remedy answers, with the content it should carry. Needs only a database:
// with no PayPal, Claude, Channel3 or Elastic keys, each integration should report its fallback, not fail. CI runs
// this on a fresh build against an empty Postgres. Usage: BASE_URL=http://localhost:3300 npm run e2e:smoke
const B = process.env.BASE_URL ?? "http://localhost:3300";
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
};

const PAGES = [
  ["/", "Recall refunds"],
  ["/try", "Try it with your own photo"],
  ["/try/presets/official-image", "The official recall picture"],
  ["/try/shop", "Buy the sample power bank"],
  ["/claim", "Find your recall"],
  ["/claim/27056", "Get your refund"],
  ["/recalls", "Recalls"],
  ["/recalls?query=space%20heater", "Showing"],
  ["/recalls/27056", "HAIARA Power Banks"],
  ["/judges", "For judges"],
  ["/learn", "How recalls work"],
  ["/about", "About Remedy"],
  ["/firm", "Brightline Home"],
  ["/firm/claims", "Claims"],
  ["/firm/plan", "Recall plan"],
  ["/firm/reports", "CPSC monthly report"],
  ["/firm/buyers", "Buyers"],
  ["/developers", "Developers"],
  ["/developers/docs", "API docs"],
  ["/developers/keys", "Your keys"],
  ["/status", "Status"],
  ["/stack", "How it is built"],
];
for (const [path, word] of PAGES) {
  const r = await fetch(B + path);
  const html = await r.text();
  check(`page ${path}`, r.status === 200 && html.includes(word) && !/giftwise/i.test(html), `${r.status}`);
}

const presetRun = await (await fetch(`${B}/api/try/presets/official-image/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json().catch(() => null);
check("try: the official-image example asks for the owner's own photo (no model call)", presetRun?.data?.result?.decided_by === "own_photo", presetRun?.data?.result?.summary?.plain);

const health = await (await fetch(`${B}/api/health`)).json();
const db = health.checks?.find((c) => c.id === "database");
check("health: the database is live", db?.mode === "live", db?.detail);
check("health: every integration reports a mode", health.checks?.every((c) => ["live", "fallback", "not_connected"].includes(c.mode)), health.checks?.map((c) => `${c.id}:${c.mode}`).join(" "));

const ledger = await fetch(`${B}/api/ledger/verify`);
const ledgerJ = await ledger.json().catch(() => null);
check("ledger: the hash chain verifies", ledger.status === 200 && ledgerJ?.data?.ok === true, `${ledgerJ?.data?.count ?? "?"} entries`);

const spec = await fetch(`${B}/openapi.json`);
const specJ = await spec.json().catch(() => null);
check("openapi.json: Remedy API", spec.status === 200 && specJ?.info?.title === "Remedy API");

const catalog = await fetch(`${B}/.well-known/ai-catalog.json`);
const cat = await catalog.json().catch(() => null);
check("discovery: AI catalog lists the MCP server", catalog.status === 200 && JSON.stringify(cat).includes("server-card"));
const card = await fetch(`${B}/api/mcp/server-card`);
check("discovery: MCP server card", card.status === 200 && (await card.json().catch(() => null))?.name === "io.github.usv240/remedy");
const llms = await fetch(`${B}/llms.txt`);
check("discovery: llms.txt", llms.status === 200 && (await llms.text()).includes("Remedy"));

const rpc = (method, params = {}) => fetch(`${B}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
check("MCP: initialize", init?.result?.serverInfo?.name === "remedy");
const ping = await rpc("tools/call", { name: "ping", arguments: {} });
check("MCP: the ping tool answers", ping?.result?.structuredContent?.ok === true);
const tools = await rpc("tools/list");
check("MCP: the recall tools are listed", ["search_recalls", "get_proof_rule", "verify_photo", "open_claim", "claim_status"].every((n) => tools?.result?.tools?.some((t) => t.name === n)));

// The public API: works with no Elastic (the in-app ranking) and no AI key (stored rules, free checks).
const search = await (await fetch(`${B}/api/v1/recalls?query=power%20bank&limit=3`)).json().catch(() => null);
check("API: recall search answers, with a proof rule on photo-refund hits", search?.data?.hits?.length > 0 && search.data.hits.some((h) => h.photo_refund && h.proof_rule), search?.meta?.search?.mode);
const one = await (await fetch(`${B}/api/v1/recalls/27056`)).json().catch(() => null);
check("API: one recall with its stored rule", one?.data?.proof_rule?.actions?.includes("write_recalled") === true);

const theme = await fetch(`${B}/vendor/bryntum/stockholm-light.css`);
check("Bryntum theme is served", theme.status === 200 && (theme.headers.get("content-type") ?? "").includes("text/css"));

const head = await fetch(B + "/");
check("security headers", Boolean(head.headers.get("strict-transport-security") && head.headers.get("x-content-type-options") && head.headers.get("content-security-policy")));

const firmClaims = await fetch(`${B}/api/firm/claims`);
check("firm: claims API answers", [200, 404].includes(firmClaims.status), `${firmClaims.status}`);
const firmTemplate = await fetch(`${B}/api/firm/buyers/template`);
check("firm: sales CSV template", firmTemplate.status === 200 && (await firmTemplate.text()).startsWith("order_id,order_date"));

console.log(failed ? `\n${failed} checks failed` : "\nall smoke checks pass");
process.exitCode = failed ? 1 : 0;
