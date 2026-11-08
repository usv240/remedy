// How many words a page shows before anything is opened: the text a reader sees on load, with closed disclosures,
// Technical-only details and screen-reader-only text left out, and all of it counted. Usage:
//   BASE_URL=http://localhost:3400 node scripts/public/word-count.mjs / /evidence
import { chromium } from "playwright-core";

const B = process.env.BASE_URL ?? "http://localhost:3400";
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ["/"];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
for (const p of paths) {
  await page.goto(B + p, { waitUntil: "networkidle" });
  const n = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    // innerText leaves out what is not rendered: closed <details>, display:none and the like.
    const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    const shown = words(main.innerText);
    const all = words(main.textContent ?? "");
    return { shown, all };
  });
  console.log(`${p}: ${n.shown} words shown on load, ${n.all} in the page with every disclosure open`);
}
await b.close();
