// `next build`, after copying Bryntum's script into public/, with Turbopack's threads and Next's build workers capped.
//
// Render's build machines report 48 CPUs but give a build 8 GB of memory, and Next starts a build worker per CPU. Capped
// at 8, a local build peaks at about half the memory of the uncapped one, which leaves room on Render. BUILD_THREADS
// changes the cap.
import { spawnSync } from "node:child_process";
import os from "node:os";
import "./vendor-bryntum.mjs";

const cap = String(Math.max(1, Math.min(os.availableParallelism(), Number(process.env.BUILD_THREADS) || 8)));
const env = {
  ...process.env,
  TOKIO_WORKER_THREADS: process.env.TOKIO_WORKER_THREADS || cap,
  RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS || cap,
  NEXT_BUILD_CPUS: cap,
};
console.log(`next build with ${cap} threads and workers (${os.availableParallelism()} CPUs reported)`);
const r = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", ...process.argv.slice(2)], { stdio: "inherit", env });
process.exit(r.status ?? 1);
