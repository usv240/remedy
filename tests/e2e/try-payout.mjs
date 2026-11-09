// The one-click sandbox payout on /try, end to end, in a real browser against a running Remedy with PayPal sandbox
// keys (BASE_URL, default :3300): run Brightline's sample charger, press "Send $34.99 to the sandbox buyer", land on the
// receipt, and watch PayPal report the payout paid. Then the same visitor presses again and is shown the most recent
// receipt instead of a second payout. One real sandbox payout of $34.99 (practice money) per run.
//   node --env-file=.env.local tests/e2e/try-payout.mjs
import { chromium } from "playwright-core";
import { startTranscript } from "./transcript.mjs";

const B = process.env.BASE_URL ?? "http://localhost:3300";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const transcript = startTranscript("try-payout", "The one-click sandbox payout on /try: the sample charger verified, Send $34.99 to the sandbox buyer, the receipt with PayPal's batch id, PayPal reporting it paid, and a second press shown the latest receipt.");
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  | ${detail}` : ""}`);
  transcript.step(name, ok, detail);
};

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${B}/try`, { waitUntil: "networkidle" });
    const first = page.locator(".tr-preset").first();
    check("the first example is Brightline's sample charger, cord cut", /sample charger, cord cut/i.test(await first.locator(".tr-preset-title").innerText()));
    await first.getByRole("button", { name: "Run it", exact: true }).click();
    const pay = first.getByRole("button", { name: /Send \$34\.99 to the sandbox buyer/ });
    await pay.waitFor({ timeout: 30_000 });
    check("once verified, the result offers the sandbox payout, labelled as one", (await first.locator(".tr-pay .pill").innerText()).trim() === "Sandbox payout");
    const t0 = Date.now();
    const answer = page.waitForResponse((r) => r.url().endsWith("/api/try/sandbox-payout") && r.request().method() === "POST", { timeout: 120_000 });
    await pay.click();
    const body = await (await answer).json();
    const r = body?.data;
    check("PayPal accepted the payout: sent, $34.99, to the sandbox buyer, with a batch id", r?.sent === true && r.amount === "$34.99" && Boolean(r.receipt?.batchId), `${r?.plain ?? body?.error?.message ?? ""} batch ${r?.receipt?.batchId ?? "none"}`);
    transcript.ids({ claim_ids: r?.receipt?.claimId ? [r.receipt.claimId] : [], amount: "34.99", route: "payout", payout_batch_id: r?.receipt?.batchId, payout_item_id: r?.receipt?.itemId });
    await page.waitForURL(/\/r\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    // The receipt at /r/<claim> lives in this run's database; the transcript points at the recorded copy every
    // deployment serves from this file (src/app/r/recorded/page.tsx).
    check("the page opens the receipt", page.url().endsWith(r?.receipt?.url ?? "-"), "the run opened its own claim's receipt; the recorded copy is /r/recorded");
    // The receipt follows PayPal live; poll the claim the way the receipt does until PayPal reports it paid.
    let view = null;
    while (Date.now() - t0 < 120_000) {
      view = (await (await fetch(`${B}/api/claims/${r.receipt.claimId}?refresh=1`)).json().catch(() => null))?.data ?? view;
      if (view?.payment?.status === "paid") break;
      await sleep(3000);
    }
    const seconds = Math.round((Date.now() - t0) / 1000);
    check("PayPal reports the payout paid", view?.payment?.status === "paid", `${seconds} s, ${view?.payment?.paypal_status}, item ${view?.payment?.ids?.payout_item_id}`);
    transcript.ids({ payout_item_id: view?.payment?.ids?.payout_item_id, payout_status: view?.payment?.paypal_status, approval_to_paid_s: seconds });
    await page.reload({ waitUntil: "networkidle" });
    const receipt = await page.locator("main").innerText();
    check("the receipt shows the sandbox payout batch and the paid status", receipt.includes(r.receipt.batchId) && /Paid \$34\.99/.test(receipt), receipt.match(/Sandbox payout[^\n]*/)?.[0] ?? "");

    // The same visitor presses again: nothing is sent, and the latest receipt is shown.
    await page.goto(`${B}/try`, { waitUntil: "networkidle" });
    const again = page.locator(".tr-preset").first();
    await again.getByRole("button", { name: "Run it", exact: true }).click();
    const pay2 = again.getByRole("button", { name: /Send \$34\.99 to the sandbox buyer/ });
    await pay2.waitFor({ timeout: 30_000 });
    const second = page.waitForResponse((x) => x.url().endsWith("/api/try/sandbox-payout"), { timeout: 60_000 });
    await pay2.click();
    const r2 = (await (await second).json())?.data;
    await again.locator(".tr-pay-state a").waitFor({ timeout: 10_000 });
    check("a second press the same day sends nothing and shows the most recent receipt", r2?.sent === false && r2.reason === "visitor" && r2.receipt?.batchId === r.receipt.batchId, r2?.plain);
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => {
    console.error("try-payout e2e failed:", e.message);
    fail++;
  })
  .finally(() => {
    console.log(`transcript: ${transcript.save({ passed: pass, failed: fail })}`);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
