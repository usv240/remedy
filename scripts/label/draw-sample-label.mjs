/**
 * Draws the sample label for Brightline Home's fictional charger (sample recall BH-2026-01) in the site's own type and
 * colours, with a real UPC-A barcode for its in-store number, and screenshots it with headless Chrome.
 *
 *   node scripts/label/draw-sample-label.mjs        writes public/samples/label/brightline-blc-6520.png
 *
 * CHROME_PATH overrides where Chrome is. No network, no model calls.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

const root = process.cwd();
const out = path.join(root, "public", "samples", "label", "brightline-blc-6520.png");
const font = (f) => pathToFileURL(path.join(root, "src", "app", "fonts", f)).href;

// UPC-A 400000652009: number system 4 (in-store use), so no retail product carries it.
const UPC = "400000652009";
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((c) => c.replace(/./g, (b) => (b === "0" ? "1" : "0")));
const bits = "101" + [...UPC.slice(0, 6)].map((d) => L[+d]).join("") + "01010" + [...UPC.slice(6)].map((d) => R[+d]).join("") + "101";
const mw = 3; // module width, px
const guard = (i) => i < 3 || (i >= 45 && i < 50) || i >= 92 || i < 10 || i >= 85; // guards and first/last digit bars run long
const bars = [...bits]
  .map((b, i) => (b === "1" ? `<rect x="${(i + 9) * mw}" y="0" width="${mw}" height="${guard(i) ? 112 : 100}" />` : ""))
  .join("");
const W = (95 + 18) * mw;
// Each digit sits under its own seven bars, as printed UPC-A labels show them; the first and last sit outside the guards.
const at = (i) => (i === 0 ? 3 : i === 11 ? 9 + 95 + 3 : i <= 5 ? 9 + 3 + 7 * (i - 1) + 3.5 : 9 + 50 + 7 * (i - 6) + 3.5);
const digits = [...UPC].map((d, i) => `<text x="${at(i) * mw}" y="130" class="d" text-anchor="middle">${d}</text>`).join("");
const barcode = `<svg width="${W}" height="134" viewBox="0 0 ${W} 134" aria-hidden="true"><g fill="#030407">${bars}</g>${digits}</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Plex;src:url(${font("IBMPlexSans-400.woff2")});font-weight:400}
@font-face{font-family:Plex;src:url(${font("IBMPlexSans-500.woff2")});font-weight:500}
@font-face{font-family:Plex;src:url(${font("IBMPlexSans-600.woff2")});font-weight:600}
@font-face{font-family:Sentient;src:url(${font("Sentient-500.woff2")});font-weight:500}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:740px;background:#16181d}
body{display:grid;place-items:center;font-family:Plex,sans-serif;color:#030407;
  background: radial-gradient(120% 90% at 30% 20%, #23262d 0%, #16181d 55%, #0f1014 100%)}
.screw{position:absolute;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#3a3e47,#121318 70%);box-shadow:inset 0 0 0 2px #0b0c10}
.label{position:relative;width:960px;height:540px;background:#f7f8f3;border-radius:22px;padding:40px 46px 36px;
  box-shadow:0 2px 0 rgba(255,255,255,.06), 0 24px 60px rgba(0,0,0,.45);display:grid;grid-template-columns:1fr 360px;grid-template-rows:auto 1fr auto;gap:0 40px}
.top{grid-column:1/3;display:flex;align-items:flex-end;justify-content:space-between;border-bottom:3px solid #030407;padding-bottom:16px;margin-bottom:22px}
.brand{font-family:Sentient,serif;font-weight:500;font-size:62px;letter-spacing:-.02em;line-height:1}
.kind{font-weight:600;font-size:30px;letter-spacing:.02em;text-transform:uppercase}
.rows{display:grid;grid-template-columns:auto 1fr;column-gap:22px;row-gap:12px;font-size:27px;align-content:start}
.k{font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:22px;color:#30332b;padding-top:5px}
.v{font-weight:500}
.model{font-size:40px;font-weight:600;letter-spacing:.01em}
.side{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:22px;padding-top:6px}
.d{font:500 21px Plex,sans-serif;fill:#030407}
.marks{display:flex;gap:22px;align-items:center}
.mark{width:66px;height:66px;border:3px solid #030407;border-radius:6px;display:grid;place-items:center}
.mark span{display:block;width:34px;height:34px;border:3px solid #030407}
.foot{grid-column:1/3;display:flex;justify-content:space-between;align-items:center;border-top:2px solid #c9ccc2;padding-top:16px;font-size:20px;color:#30332b}
.stamp{position:absolute;top:-22px;right:38px;background:#d4ff24;color:#030407;border:2px solid #5c7300;border-radius:999px;
  font-weight:600;font-size:24px;letter-spacing:.08em;text-transform:uppercase;padding:8px 22px}
</style></head><body>
<div class="screw" style="left:40px;top:40px"></div><div class="screw" style="right:40px;top:40px"></div>
<div class="screw" style="left:40px;bottom:40px"></div><div class="screw" style="right:40px;bottom:40px"></div>
<div class="label">
  <div class="stamp">Sample label</div>
  <div class="top"><div class="brand">Brightline</div><div class="kind">Laptop Charger 65W</div></div>
  <div class="rows">
    <div class="k">Model</div><div class="v model">BLC-6520</div>
    <div class="k">Input</div><div class="v">100-240V~ 1.5A 50/60Hz</div>
    <div class="k">Output</div><div class="v">19.5V &#x2393; 3.34A, 65W</div>
    <div class="k">Mfg. date</div><div class="v">2026-01</div>
    <div class="k">Lot</div><div class="v">B2601-07</div>
  </div>
  <div class="side">
    ${barcode}
    <div class="marks"><div class="mark"><span></span></div></div>
    <div style="font-size:19px;text-align:center;color:#30332b;line-height:1.35">Indoor use only.<br>Use with Brightline laptops.</div>
  </div>
  <div class="foot"><span>Brightline Home &middot; a fictional sample firm</span><span>Made in China</span></div>
</div></body></html>`;

const dir = mkdtempSync(path.join(tmpdir(), "remedy-label-"));
const tmp = path.join(dir, "brightline-label.html");
writeFileSync(tmp, html);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const p = await b.newPage({ viewport: { width: 1200, height: 740 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(tmp).href);
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: out, type: "png" });
await b.close();
rmSync(dir, { recursive: true, force: true });
console.log("wrote", path.relative(root, out));
