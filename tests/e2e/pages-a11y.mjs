// axe (WCAG 2.2 AA, serious and critical) and sideways-scroll checks on every page, desktop and phone, light and dark.
// Usage: BASE_URL=http://localhost:3300 npm run e2e:a11y (CHROME_PATH points at Chrome when it is not in the usual place).
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
const B = process.env.BASE_URL ?? "http://localhost:3300";
const AXE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

const routes = ["/", "/try", "/try/presets/cpsc-example", "/try/shop", "/claim", "/claim/27056", "/claim/BH-2026-01", "/try/presets/sample-charger-cut", "/recalls", "/recalls?query=space%20heater", "/recalls/27056", "/recalls/BH-2026-01", "/judges", "/learn", "/about", "/firm", "/firm/claims", "/firm/plan", "/firm/reports", "/firm/buyers", "/developers", "/developers/docs", "/developers/keys", "/status", "/stack"];

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
let failed = 0;
let views = 0;
for (const route of routes)
  for (const w of [1440, 390])
    for (const theme of ["light", "dark"]) {
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
process.exitCode = failed ? 1 : 0;
