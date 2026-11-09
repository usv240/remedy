// axe (WCAG 2.2 AA, serious and critical) and sideways-scroll checks on every page, desktop and phone, light and dark.
// Usage: BASE_URL=http://localhost:3300 npm run e2e:a11y (CHROME_PATH points at Chrome when it is not in the usual place).
// Each run writes its tally to content/public/a11y.json, which scripts/facts.ts folds into content/public/facts.json.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
const B = process.env.BASE_URL ?? "http://localhost:3300";
const AXE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

const routes = ["/", "/try", "/evidence/photo-checks", "/evidence/operations", "/evidence/market", "/claim/25007", "/try/presets/cpsc-example", "/try/shop", "/claim", "/claim/27056", "/claim/BH-2026-01", "/try/presets/sample-charger-cut", "/r/recorded", "/recalls", "/recalls?query=space%20heater", "/recalls/27056", "/recalls/BH-2026-01", "/evidence", "/learn", "/about", "/firm", "/firm/claims", "/firm/plan", "/firm/reports", "/firm/buyers", "/firm/scan", "/developers", "/developers/docs", "/developers/keys", "/status", "/ops", "/stack"];
const WIDTHS = [1440, 390];
const THEMES = ["light", "dark"];

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
let failed = 0;
let views = 0;
for (const route of routes)
  for (const w of WIDTHS)
    for (const theme of THEMES) {
      const p = await b.newPage({ viewport: { width: w, height: 900 } });
      await p.goto(`${B}${route}${route.includes("?") ? "&" : "?"}theme=${theme}`, { waitUntil: "networkidle" });
      await p.addScriptTag({ content: AXE });
      const v = await p.evaluate(async () =>
        (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => `${x.id}: ${x.nodes[0]?.target}`),
      );
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      views++;
      if (v.length || overflow) failed++;
      console.log(route, w, theme, v.length ? "FAIL " + v.join("; ") : "axe ok", overflow ? "| SIDEWAYS SCROLL" : "");
      await p.close();
    }
await b.close();
console.log(failed ? `\n${failed} of ${views} page views with problems` : `\nall ${views} page views pass`);
writeFileSync(
  "content/public/a11y.json",
  JSON.stringify({ note: "Written by tests/e2e/pages-a11y.mjs: axe (WCAG 2.2 AA, serious and critical) and sideways scroll, each page at phone and desktop width in light and dark.", ranAt: new Date().toISOString(), pages: routes.length, widths: WIDTHS, themes: THEMES, views, passed: views - failed }, null, 2) + "\n",
);
process.exitCode = failed ? 1 : 0;
