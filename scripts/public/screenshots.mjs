// Retake the README's screenshots (docs/img) from a running Remedy, light theme, at the sizes the README uses. Run it
// against a production build seeded the way Render seeds (render.yaml preDeployCommand), so the queue shows what live
// shows. The two receipts need claims the e2e suites pay in the sandbox: pass their ids, or they are left as they are.
//   BASE_URL=http://localhost:3400 node scripts/public/screenshots.mjs [--receipt <claimId>] [--refund <claimId>] [--only 7,8]
import { chromium } from "playwright-core";

const B = process.env.BASE_URL ?? "http://localhost:3400";
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : null;
};
const only = arg("--only")?.split(",") ?? null;
const OUT = "docs/img";

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });

/** A page at a size, in light theme and Plain view, with motion reduced so nothing is caught mid-animation. */
async function open(path, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("remedy-theme", "light");
    } catch {}
  });
  const page = await ctx.newPage();
  await page.goto(B + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return { page, ctx };
}

const shots = {
  1: async () => {
    const { page, ctx } = await open("/", 1440, 900);
    await page.screenshot({ path: `${OUT}/1-home.png` });
    await ctx.close();
  },
  2: async () => {
    const { page, ctx } = await open("/claim/27056", 390, 1100);
    await page.screenshot({ path: `${OUT}/2-claim-checklist.png` });
    await ctx.close();
  },
  3: async () => {
    // The sample charger's recorded run on its own page: the six checks, with Right product confirmed by the reviewers.
    const { page, ctx } = await open("/try/presets/sample-charger-cut", 390, 1300);
    const box = await page.locator(".cl-checking").first().boundingBox();
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, (box?.y ?? 0) - 16));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/3-checks.png` });
    await ctx.close();
  },
  4: async () => {
    const id = arg("--receipt");
    if (!id) return console.log("4-receipt: no --receipt claim id, left as it is");
    const { page, ctx } = await open(`/r/${id}`, 390, 1000);
    await page.screenshot({ path: `${OUT}/4-receipt.png` });
    await ctx.close();
  },
  5: async () => {
    const id = arg("--refund");
    if (!id) return console.log("5-refund-to-purchase: no --refund claim id, left as it is");
    const { page, ctx } = await open(`/r/${id}`, 390, 1000);
    await page.screenshot({ path: `${OUT}/5-refund-to-purchase.png` });
    await ctx.close();
  },
  6: async () => {
    // The look-alike in the firm's queue: its drawer, scrolled to the two reviewers.
    const { page, ctx } = await open("/firm/claims", 1440, 1000);
    await page.waitForSelector(".ag-row", { timeout: 60_000 });
    await page.getByRole("button", { name: "Needs review" }).click();
    const api = await (await fetch(`${B}/api/firm/claims`)).json();
    const look = api.data.claims.find((c) => c.recallNumber === "26754" && c.photoUrl);
    await page.locator(`.ag-row[row-id="${look.id}"] .cq-open`).click();
    await page.waitForSelector(".cq-drawer[open] #cq-review", { timeout: 30_000 });
    await page.locator(".cq-drawer[open] #cq-review").scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const body = document.querySelector(".cq-drawer[open] .cq-drawer-body");
      const r = document.querySelector(".cq-drawer[open] #cq-review");
      if (body && r) body.scrollTop = r.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 140;
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/6-two-reviewers.png` });
    await ctx.close();
  },
  7: async () => {
    const { page, ctx } = await open("/firm/claims", 1440, 900);
    await page.waitForSelector(".ag-row", { timeout: 60_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/7-claims-grid.png` });
    await ctx.close();
  },
  8: async () => {
    const { page, ctx } = await open("/firm/plan", 1440, 1000);
    await page.waitForSelector(".plan-gantt .b-gantt-task", { timeout: 90_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/8-gantt-re-notice.png` });
    await ctx.close();
  },
  9: async () => {
    const { page, ctx } = await open("/firm/reports", 1440, 1000);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/9-cpsc-report.png` });
    await ctx.close();
  },
  10: async () => {
    const { page, ctx } = await open("/recalls/27056", 1440, 1000);
    await page.screenshot({ path: `${OUT}/10-proof-rule.png` });
    await ctx.close();
  },
};

for (const [n, take] of Object.entries(shots)) {
  if (only && !only.includes(n)) continue;
  await take();
  console.log(`shot ${n}`);
}
await browser.close();
