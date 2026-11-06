// Copies Bryntum Gantt's ready-built UMD file into public/, where the plan page loads it as a plain script.
//
// Bryntum's trial package (@bryntum/gantt, aliased to @bryntum/gantt-trial) ships one unminified 5.8 MB bundle.
// Turbopack runs past Render's 8 GB build memory analysing a bundle that size, so the page keeps it out of the
// bundle: the browser loads this file and src/components/gantt/bryntum-global.cjs hands its exports to the code.
// Runs after npm install and before every build.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@bryntum", "gantt", "gantt.umd.js");
const to = join(root, "public", "bryntum", "gantt.umd.js");

if (!existsSync(from)) {
  console.warn("vendor-bryntum: @bryntum/gantt is not installed; the plan page will not load.");
} else if (!existsSync(to) || statSync(to).size !== statSync(from).size || statSync(to).mtimeMs < statSync(from).mtimeMs) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log("vendor-bryntum: copied gantt.umd.js to public/bryntum/");
}
