// Approve a PayPal sandbox order as the sandbox buyer, in a real browser, the way a judge would (redirect checkout).
// Approves a sandbox order as the buyer: log in with SANDBOX_BUYER_EMAIL and
// SANDBOX_BUYER_PASSWORD, press Pay, and stop when PayPal sends the browser to the return URL (answered locally, so
// no server needs to be running). Needs Chrome (CHROME_PATH, or the default Windows install path).
import { chromium } from "playwright-core";

export async function approveAsBuyer(approveUrl: string, returnUrl: string, opts: { screenshot?: string } = {}) {
  const email = process.env.SANDBOX_BUYER_EMAIL?.trim();
  const pass = process.env.SANDBOX_BUYER_PASSWORD?.trim();
  if (!email || !pass) throw new Error("SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD are needed to approve as the buyer.");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const back = new URL(returnUrl);
    // The return page is answered here, so the run never depends on a local server.
    await page.route(`${back.origin}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>Returned from PayPal</p>" }));
    await page.goto(approveUrl, { waitUntil: "domcontentloaded" });
    const emailBox = page.locator('input#email, input[type="email"]').first();
    const passBox = page.locator('input#password, input[type="password"]').first();
    const payBtn = page
      .locator('button[data-testid="submit-button-initial"], button#payment-submit-btn, button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Continue to Review Order")')
      .first();
    await Promise.race([emailBox.waitFor({ timeout: 45000 }), passBox.waitFor({ timeout: 45000 }), payBtn.waitFor({ timeout: 45000 })]).catch(() => {});
    if (await emailBox.isVisible().catch(() => false)) {
      await emailBox.fill(email);
      const next = page.locator("button#btnNext");
      if (await next.isVisible().catch(() => false)) await next.click();
    }
    if ((await passBox.isVisible({ timeout: 10000 }).catch(() => false)) || (await passBox.waitFor({ timeout: 10000 }).then(() => true).catch(() => false))) {
      await passBox.fill(pass);
      await page.locator("button#btnLogin").click();
    }
    await payBtn.waitFor({ timeout: 60000 });
    if (opts.screenshot) await page.screenshot({ path: opts.screenshot });
    await payBtn.click();
    await page.waitForURL((u) => u.href.startsWith(returnUrl), { timeout: 90000 });
    const u = new URL(page.url());
    return { token: u.searchParams.get("token"), payerId: u.searchParams.get("PayerID") };
  } finally {
    await browser.close();
  }
}
