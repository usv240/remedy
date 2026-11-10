// "Is it recalled? Snap the label", end to end against a running build (BASE_URL, default :3300), with no model call:
// each sample label replays its recorded reading. In a real browser at desktop and phone width: a sample label to its
// recall and into that recall's claim page; the no-match label to "search by name", which fills the search; then the
// API endpoint and the MCP tool, and a photo that is not an image.
//   BASE_URL=http://localhost:3420 node tests/e2e/label.mjs
import { readFileSync } from "node:fs";

const B = process.env.BASE_URL ?? "http://localhost:3300";
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  | ${detail}` : ""}`);
};

async function browser() {
  const { chromium } = await import("playwright-core");
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  for (const v of [
    { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
    { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    const ctx = await b.newContext(v);
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    for (const [sample, recall, code] of [
      ["Brightline charger", "BH-2026-01", "BLC-6520"],
      ["Kidisle coffee maker", "26557", "KC101B"],
    ]) {
      await p.goto(`${B}/claim`, { waitUntil: "load" });
      await p.getByRole("heading", { name: "Is it recalled? Snap the label" }).waitFor();
      // Hydrated before pressing: the sample buttons are client components.
      await p.waitForFunction(() => Object.keys(document.querySelector(".lb-sample") ?? {}).some((k) => k.startsWith("__react")), null, { timeout: 15000 });
      await p.getByRole("button", { name: new RegExp(sample) }).click();
      const how = p.locator(".lb-result:not([data-state='reading']) .lb-how").first();
      await how.waitFor({ timeout: 20000 });
      const text = await how.innerText();
      check(`${v.name}: ${sample} label matches its recall by model number`, text === `Matched by model number ${code}, read from your photo.`, text);
      const meta = await p.locator(".lb-match-meta").first().innerText();
      check(`${v.name}: the card names recall ${recall}`, meta.includes(recall), meta);
      if (v.name === "desktop") {
        const source = await p.locator(".lb-read .cl-hint").first().textContent();
        check(`${v.name}: the reading is labelled recorded, with no AI call`, /Recorded reading/.test(source ?? "") && /no AI call/.test(source ?? ""), source ?? "");
      }
      const box = await p.getByRole("link", { name: "Start my claim" }).boundingBox();
      check(`${v.name}: the claim button is at least 44px tall`, (box?.height ?? 0) >= 44, String(box?.height));
      await Promise.all([p.waitForURL(`**/claim/${recall}`), p.getByRole("link", { name: "Start my claim" }).click()]);
      await p.getByRole("heading", { name: /Get your refund/ }).first().waitFor({ timeout: 15000 });
      check(`${v.name}: Start my claim opens /claim/${recall}`, p.url().endsWith(`/claim/${recall}`), p.url());
    }
    // A label no recall lists: a neutral answer, then search by name fills the search with what was read.
    await p.goto(`${B}/claim`, { waitUntil: "load" });
    await p.waitForFunction(() => Object.keys(document.querySelector(".lb-sample") ?? {}).some((k) => k.startsWith("__react")), null, { timeout: 15000 });
    await p.getByRole("button", { name: /Lenovo laptop adapter/ }).click();
    const lead = p.locator(".lb-result:not([data-state='reading']) .lb-lead").first();
    await lead.waitFor({ timeout: 20000 });
    const said = await lead.innerText();
    check(`${v.name}: the Lenovo label says no recall lists its models`, said.startsWith("No recall since January 2024 lists models 92P1154, 42T5283"), said);
    await p.getByRole("button", { name: /^Search for / }).click();
    const input = p.getByRole("searchbox", { name: "What is the product?" });
    await p.waitForFunction(() => (document.querySelector("#find input[type=search]")?.value ?? "").length > 0, null, { timeout: 5000 });
    check(`${v.name}: search by name fills the search with the brand and product read`, (await input.inputValue()).toLowerCase() === "lenovo ac adapter", await input.inputValue());
    const scroll = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${v.name}: no sideways scroll`, scroll <= 0, String(scroll));
    if (v.name === "phone") {
      const take = await p.locator(".lb-take").isVisible();
      check("phone: the camera button shows (capture=environment)", take && (await p.locator(".lb-take input").getAttribute("capture")) === "environment");
    } else {
      check("desktop: one button chooses a file", !(await p.locator(".lb-take").isVisible()) && (await p.locator(".lb-choose").isVisible()));
    }
    check(`${v.name}: no page errors`, errors.length === 0, errors.join("; "));
    await ctx.close();
  }
  // The home page offers it on the owner's path.
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${B}/`, { waitUntil: "networkidle" });
  const link = p.getByRole("link", { name: "Is it recalled? Snap the label" });
  check("home: the owner's link to snap the label", (await link.getAttribute("href")) === "/claim#snap");
  await b.close();
}

async function api() {
  const post = (body, headers = { "Content-Type": "application/json" }) => fetch(`${B}/api/v1/label`, { method: "POST", headers, body }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }));
  const k = await post(JSON.stringify({ sample: "kidisle" }));
  check("POST /api/v1/label with a sample: a match on 26557, recorded", k.status === 200 && k.j?.data?.outcome === "match" && k.j.data.matches[0].number === "26557" && k.j.data.source.kind === "recorded", JSON.stringify(k.j?.data?.plain));
  check("the claim link is absolute on this server", String(k.j?.data?.matches?.[0]?.claim_url).startsWith("http") && String(k.j?.data?.matches?.[0]?.claim_url).endsWith("/claim/26557"));
  const fd = new FormData();
  fd.set("photo", new Blob([readFileSync("public/samples/label/brightline-blc-6520.png")], { type: "image/png" }), "label.png");
  const r = await fetch(`${B}/api/v1/label`, { method: "POST", body: fd });
  const j = await r.json();
  check("a sample's own file sent as a photo replays its reading", r.status === 200 && j.data?.matches?.[0]?.number === "BH-2026-01" && j.data.source.kind === "recorded");
  const bad = new FormData();
  bad.set("photo", new Blob([Buffer.from("not a photo")], { type: "image/jpeg" }), "x.jpg");
  const b2 = await fetch(`${B}/api/v1/label`, { method: "POST", body: bad });
  check("a file that is not a photo is answered 415", b2.status === 415);
  const none = await post("{}");
  check("a body with neither is answered 400", none.status === 400);
  const spec = await fetch(`${B}/openapi.json`).then((x) => x.json());
  check("OpenAPI documents POST /api/v1/label", Boolean(spec.paths?.["/api/v1/label"]?.post));
  const rpc = (method, params = {}) => fetch(`${B}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json());
  const list = await rpc("tools/list");
  const names = (list.result?.tools ?? []).map((t) => t.name);
  check("MCP tools/list has check_label among eight tools", names.includes("check_label") && names.length === 8, names.join(" "));
  const call = await rpc("tools/call", { name: "check_label", arguments: { sample: "lenovo" } });
  const text = call.result?.content?.[0]?.text ?? "";
  check("MCP check_label on the Lenovo sample: no_match", /^no_match: No recall since January 2024 lists models 92P1154/.test(text), text.split("\n")[0]);
}

try {
  await api();
  await browser();
} catch (e) {
  check("the run finished", false, e instanceof Error ? e.message : String(e));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
