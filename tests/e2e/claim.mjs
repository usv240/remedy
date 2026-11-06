// The owner's path end to end, against a running Remedy (dev server at BASE_URL, default :3300), in the PayPal sandbox.
//   1. Ready-made examples: the official CPSC picture asks for the owner's own photo; the blurry photo asks for a retake.
//   2. A claim with the official picture, streamed (claim, stage, result events): own-photo retake, no payment possible.
//   3. The full verified-to-payout path at $1.25: a claim with no live AI goes to firm review (no Claude spend), the
//      owner leaves the sandbox buyer's email, paying again pays nothing, the firm approves (e2e-only route guarded by
//      CHECKS_SECRET), PayPal pays, the receipt shows "Paid $1.25" and the sandbox payout ID.
//   0. The claim page in a real browser: pick a photo, check it, see the result.
// It removes its own test claims afterwards (payments and ledger entries for real sandbox payouts stay), unless --keep.
//   node --env-file=.env.local tests/e2e/claim.mjs [--keep]
import { readFileSync } from "node:fs";
import pg from "pg";

const B = process.env.BASE_URL ?? "http://localhost:3300";
const SECRET = process.env.CHECKS_SECRET ?? "";
const BUYER = process.env.SANDBOX_BUYER_EMAIL ?? "";
const keep = process.argv.includes("--keep");
const FIX = "content/verify/fixtures";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  | ${detail}` : ""}`);
};
const made = [];

/** A JSON call. A dev server compiling a route for the first time can answer with an HTML page once: retry those. */
async function json(path, init) {
  for (let i = 0; ; i++) {
    const r = await fetch(B + path, init);
    const j = await r.json().catch(() => null);
    if (j || i >= 2 || init?.body instanceof FormData) return { status: r.status, j, headers: r.headers };
    await sleep(3000);
  }
}

function form(photo, recall, extra = {}) {
  const fd = new FormData();
  fd.set("recall", recall);
  fd.set("photo", new Blob([readFileSync(`${FIX}/${photo}`)], { type: photo.endsWith(".png") ? "image/png" : "image/jpeg" }), photo.split("/").pop());
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

async function main() {
  if (!SECRET) throw new Error("CHECKS_SECRET is not set; run with --env-file=.env.local");

  // 0. The claim page in a real browser (first, while the per-minute API limit is fresh).
  try {
    const { chromium } = await import("playwright-core");
    const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-checks-secret": SECRET } });
    await p.goto(`${B}/claim/27056`, { waitUntil: "networkidle" });
    await p.locator('input[type="file"]').nth(1).setInputFiles(`${FIX}/official/27056-haiara-1.jpg`);
    await p.waitForSelector(".cl-precheck, .cl-precheck-ok");
    if (await p.locator(".cl-precheck").count()) await p.getByLabel("Send it anyway").check();
    const began = Date.now();
    const posted = p.waitForResponse((r) => r.url().endsWith("/api/claims") && r.request().method() === "POST");
    await p.getByRole("button", { name: "Check my photo" }).click();
    const browserId = /"type":"claim","id":"([0-9a-f-]{36})"/.exec(await (await posted).text())?.[1];
    if (browserId) made.push(browserId);
    await p.waitForSelector(".cl-result", { timeout: 60_000 });
    const title = await p.locator(".cl-result-title").innerText();
    const words = await p.locator(".cl-check-word").allInnerTexts();
    check("browser: the claim page checks a photo and shows the result", /own product|recall notice|your own/i.test(title) && words.length === 6, `${title} in ${Date.now() - began} ms`);
    await b.close();
  } catch (e) {
    check("browser: the claim page checks a photo and shows the result", false, e.message);
  }

  // 1. Ready-made examples (no model call, no claim, no payment).
  const off = await json("/api/try/presets/official-image/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("preset official-image: asks for the owner's own photo", off.j?.data?.result?.decision === "retake" && off.j.data.result.decided_by === "own_photo", off.j?.data?.result?.summary?.plain);
  check("preset official-image: own-photo check is the reason, and nothing is paid", off.j?.data?.result?.checks?.find((c) => c.id === "C3")?.status === "fail" && off.j.data.result.payment === null);
  const blur = await json("/api/try/presets/blurry/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("preset blurry: a friendly retake from the quality precheck", blur.j?.data?.result?.decision === "retake" && blur.j.data.result.decided_by === "quality", blur.j?.data?.result?.guidance?.plain);
  const list = await json("/api/try/presets");
  check("presets list: four examples, and the user photos say more are coming when there are none", list.j?.data?.presets?.length >= 4 && (list.j.data.user.length > 0 || list.j.data.more_coming === true));
  const dl = await fetch(`${B}/api/try/presets/official-image`);
  check("preset download is a JSON file", dl.status === 200 && (dl.headers.get("content-disposition") ?? "").includes("attachment") && Boolean((await dl.json()).preset));
  const photo = await fetch(`${B}/api/try/presets/official-image/photo?download=1`);
  check("preset photo downloads", photo.status === 200 && (photo.headers.get("content-type") ?? "").startsWith("image/"));

  // 2. A claim with the official picture, streamed.
  const sse = await fetch(`${B}/api/claims`, { method: "POST", body: form("official/27056-haiara-1.jpg", "27056"), headers: { Accept: "text/event-stream", "x-checks-secret": SECRET } });
  const text = await sse.text();
  const events = [...text.matchAll(/^event: (\w+)\ndata: (.+)$/gm)].map((m) => ({ type: m[1], data: JSON.parse(m[2]) }));
  const first = events.find((e) => e.type === "claim");
  const result = events.find((e) => e.type === "result")?.data?.claim;
  if (first) made.push(first.data.id);
  check("streamed claim: events arrive in order (claim, stage, result)", events[0]?.type === "claim" && events.some((e) => e.type === "stage") && events.at(-1)?.type === "result", events.map((e) => e.type).join(","));
  check("streamed claim: the official picture gets the own-photo retake", result?.decision === "retake" && result?.decided_by === "own_photo", result?.guidance?.plain);
  const payRetake = await json(`/api/claims/${first?.data?.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "money", payee_type: "email", payee: "jordan@example.com" }) });
  check("a retake cannot be paid", payRetake.status === 409, payRetake.j?.error?.message);

  // The demo tier allows 20 API calls a minute per client; let the window move before the payment steps.
  await sleep(25_000);

  // 3. Firm review, then the firm approves, then PayPal pays $1.25.
  const created = await json("/api/claims", { method: "POST", body: form("other/commons-coffee-in-a-mug.jpg", "27056", { e2e_no_ai: "1", e2e_amount: "1.25" }), headers: { "x-checks-secret": SECRET } });
  const claim = created.j?.data;
  if (claim?.id) made.push(claim.id);
  check("claim with no live AI goes to firm review at the test amount", created.status === 200 && claim?.decision === "firm_review" && claim?.amount?.value === "1.25", `${claim?.id} ${claim?.checks?.map((c) => `${c.id}:${c.status}`).join(" ")}`);
  const noPayee = await json(`/api/claims/${claim.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "money" }) });
  check("paying with no payee asks where to send it", noPayee.status === 400, noPayee.j?.error?.message);
  const bad = await json(`/api/claims/${claim.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "money", payee_type: "phone", payee: "123" }) });
  check("a short phone number is refused in plain words", bad.status === 400 && /10-digit/.test(bad.j?.error?.message ?? ""), bad.j?.error?.message);
  const planned = await json(`/api/claims/${claim.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "money", payee_type: "email", payee: BUYER }) });
  check("firm review: the payee is kept and the payment waits for the firm", planned.status === 200 && planned.j?.data?.kind === "needs_approval" && planned.j.data.claim.payment?.plan_status === "awaiting_approval", planned.j?.data?.plain);
  check("the payee is shown masked, never in full", JSON.stringify(planned.j).includes(BUYER) === false && /\*\*\*|•••/.test(planned.j?.data?.claim?.payment?.payee?.masked ?? ""), planned.j?.data?.claim?.payment?.payee?.masked);
  const again = await json(`/api/claims/${claim.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "money", payee_type: "email", payee: BUYER }) });
  check("paying again changes nothing", again.status === 200 && again.j?.data?.claim?.payment?.plan_status === "awaiting_approval");
  const noSecret = await json(`/api/claims/${claim.id}/e2e-approve`, { method: "POST" });
  check("the test approval route does not exist without CHECKS_SECRET", noSecret.status === 404);
  const approved = await json(`/api/claims/${claim.id}/e2e-approve`, { method: "POST", headers: { "x-checks-secret": SECRET } });
  check("the firm approves and the payout is sent", approved.status === 200 && approved.j?.data?.kind === "sent", `${approved.j?.data?.plain} ${approved.j?.data?.claim?.payment?.ids?.payout_batch_id ?? ""}`);
  const t0 = Date.now();
  let view = approved.j?.data?.claim;
  while (view?.payment?.status !== "paid" && Date.now() - t0 < 120_000) {
    await sleep(3000);
    view = (await json(`/api/claims/${claim.id}?refresh=1`)).j?.data ?? view;
  }
  check("PayPal reports the payout paid (polling, as the receipt does)", view?.payment?.status === "paid" && view?.status === "paid", `${Math.round((Date.now() - t0) / 1000)} s, ${view?.payment?.paypal_status}, item ${view?.payment?.ids?.payout_item_id}`);
  const receipt = await (await fetch(`${B}/r/${claim.id}`)).text();
  check("the receipt says Paid $1.25, with the sandbox payout ID and the labels", receipt.includes("Paid $1.25") && receipt.includes("Sandbox payout ID") && receipt.includes("Remedy is not affiliated with the recalling firm") && receipt.includes("Thank you for keeping your home safe"));
  const ph = await fetch(`${B}/api/claims/${claim.id}/photo`);
  check("the claim photo is served for the receipt", ph.status === 200 && ph.headers.get("content-type") === "image/jpeg");
  const badId = await json("/api/claims/not-a-claim");
  check("a malformed claim id is refused", badId.status === 400);
  check("routes carry rate-limit headers", Boolean(badId.headers.get("x-ratelimit-limit")));

}

main()
  .catch((e) => {
    console.error("claim e2e failed:", e.message);
    fail++;
  })
  .finally(async () => {
    if (!keep && process.env.DATABASE_URL) {
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      // Only the claims this run made (the browser one included), never anyone else's.
      const { rows } = await c.query("select id, photo_id from claim where is_sample and id = any($1::uuid[])", [made]);
      for (const r of rows) {
        await c.query("delete from plan_task where data->>'claimId' = $1", [r.id]);
        await c.query("delete from claim where id = $1", [r.id]);
        if (r.photo_id) {
          await c.query("delete from image_hash where source = 'claim' and ref = $1", [r.photo_id]);
          await c.query("delete from photo where id = $1", [r.photo_id]);
        }
      }
      await c.end();
      console.log(`removed ${rows.length} test claims (ledger entries stay, as a ledger should)`);
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
