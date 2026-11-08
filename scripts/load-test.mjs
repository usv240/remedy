// A load test of the free paths: 100 virtual users at once, each running the same three calls in a row against a
// running Remedy (the local production build, by default), measuring p50, p95 and p99 latency and the error rate per
// path, then writing content/public/load-test.json for the Evidence page. No model call: the official-picture claim
// is settled by the perceptual hash before any vision call.
//   1. POST /api/claims with the recall's own official picture (27056): the own-photo retake, no AI, no payment
//   2. GET /api/v1/recalls?query=power bank: recall search (Elastic, or the in-app ranking)
//   3. GET /api/v1/scan/sample: the catalog scan sample
// Each virtual user carries its own x-forwarded-for, so the per-visitor limits see 100 visitors, as a real crowd
// would. The claims it makes are removed at the end (DATABASE_URL), unless --keep.
// Each claim also reports the server's own stage timings (the check itself, alone) and, from the job table, how long
// its job waited in the queue, so the file says what each figure measures: the client time includes the wait.
// --only claim runs just the claim path; --alone first times one claim with nothing else running.
//   node --env-file=.env.local scripts/load-test.mjs [--users 100] [--only claim] [--keep]     BASE_URL=http://localhost:3400
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import pg from "pg";

const B = process.env.BASE_URL ?? "http://localhost:3400";
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const USERS = Number(arg("--users", 100));
const keep = process.argv.includes("--keep");
const ONLY = arg("--only", null);
/** --change "what changed": keep the claim figures of the file this run replaces, as `before`, to compare. */
const CHANGE = arg("--change", null);
const previous = (() => {
  try {
    return JSON.parse(readFileSync("content/public/load-test.json", "utf8"));
  } catch {
    return null;
  }
})();
const PHOTO = "content/verify/fixtures/official/27056-haiara-1.jpg";
const photo = readFileSync(PHOTO);

const PATHS = {
  claim: { name: "POST /api/claims (official picture, no AI)", run: claim },
  search: { name: "GET /api/v1/recalls?query=power bank", run: (h) => get("/api/v1/recalls?query=power%20bank&limit=5", h, (j) => j?.data?.hits?.length > 0) },
  scan: { name: "GET /api/v1/scan/sample", run: (h) => get("/api/v1/scan/sample", h, (j) => j?.data?.items?.length > 0) },
};
const claimIds = [];
/** The server's own timings for each claim, from its answer (result.timings). */
const serverTimings = [];

async function get(path, headers, okIf) {
  const r = await fetch(B + path, { headers });
  const j = await r.json().catch(() => null);
  return { ok: r.status === 200 && okIf(j), status: r.status };
}

async function claim(headers) {
  const fd = new FormData();
  fd.set("recall", "27056");
  fd.set("photo", new Blob([photo], { type: "image/jpeg" }), "official.jpg");
  const r = await fetch(`${B}/api/claims`, { method: "POST", body: fd, headers });
  const j = await r.json().catch(() => null);
  if (j?.data?.id) claimIds.push(j.data.id);
  if (j?.data?.timings) serverTimings.push(j.data.timings);
  return { ok: r.status === 200 && j?.data?.decision === "retake" && j.data.decided_by === "own_photo", status: r.status };
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

async function main() {
  const health = await fetch(`${B}/api/health`).then((r) => r.json());
  if (ONLY) for (const k of Object.keys(PATHS)) if (k !== ONLY) delete PATHS[k];
  // One claim alone first: the claim path's time with nothing else running, on the same server.
  const aloneT = performance.now();
  const alone = await claim({ "x-forwarded-for": "203.0.113.251", "x-request-id": "load_alone" });
  const aloneMs = Math.round(performance.now() - aloneT);
  const aloneServer = serverTimings.pop() ?? null;
  const samples = Object.fromEntries(Object.keys(PATHS).map((k) => [k, { ms: [], errors: 0, statuses: {} }]));
  const started = Date.now();
  await Promise.all(
    Array.from({ length: USERS }, async (_, u) => {
      // A distinct address per virtual user, in a documentation range (RFC 5737), never a real one.
      const headers = { "x-forwarded-for": `203.0.113.${(u % 250) + 1}`, "x-request-id": `load_${started.toString(36)}_${u}` };
      for (const [k, p] of Object.entries(PATHS)) {
        const t = performance.now();
        let r;
        try {
          r = await p.run(headers);
        } catch {
          r = { ok: false, status: 0 };
        }
        const ms = performance.now() - t;
        const s = samples[k];
        s.ms.push(ms);
        s.statuses[r.status] = (s.statuses[r.status] ?? 0) + 1;
        if (!r.ok) s.errors++;
      }
    }),
  );
  const wallMs = Date.now() - started;
  const results = Object.entries(PATHS).map(([k, p]) => {
    const sorted = [...samples[k].ms].sort((a, b) => a - b);
    return {
      id: k,
      name: p.name,
      requests: sorted.length,
      p50_ms: Math.round(quantile(sorted, 0.5)),
      p95_ms: Math.round(quantile(sorted, 0.95)),
      p99_ms: Math.round(quantile(sorted, 0.99)),
      max_ms: Math.round(sorted.at(-1) ?? 0),
      errors: samples[k].errors,
      error_rate: sorted.length ? samples[k].errors / sorted.length : 0,
      statuses: samples[k].statuses,
    };
  });
  const totalReq = results.reduce((s, r) => s + r.requests, 0);
  const spread = (xs) => {
    const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
    return s.length ? { p50: Math.round(quantile(s, 0.5)), p95: Math.round(quantile(s, 0.95)), max: Math.round(s.at(-1)) } : null;
  };
  // How long each claim's job waited before it ran, and ran, from the job table (when DATABASE_URL is set).
  let queue = null;
  if (process.env.DATABASE_URL && claimIds.length) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      const rows = (await c.query("select extract(epoch from (updated - created)) * 1000 as total from job where kind = 'verify_claim' and payload->>'claimId' = any($1::text[])", [claimIds])).rows;
      queue = { jobCreatedToDone: spread(rows.map((r) => Number(r.total))) };
    } finally {
      await c.end();
    }
  }
  const stages = Object.fromEntries(["decode_ms", "official_ms", "match_ms", "checks_ms", "total_ms"].map((k) => [k, spread(serverTimings.map((t) => t[k]))]));
  const out = {
    measuredAt: new Date().toISOString(),
    baseUrl: B,
    users: USERS,
    method: `${USERS} virtual users started at once, each running the three calls in a row (claim, search, scan sample), ${totalReq} requests in all; latency measured in the client from request start to the full JSON body; a run counts as an error when the status is not 200 or the body is not the expected answer. Each user carries its own x-forwarded-for so the per-visitor limits see ${USERS} visitors. The claim uses the recall's own official picture, settled by the perceptual hash with no model call.`,
    machine: { platform: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model?.trim() ?? "unknown", cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1e9), node: process.version },
    server: { build: "next start, local production build", worker: health?.checks?.find((c) => c.id === "worker")?.mode === "live" ? "running" : "not running (inline fallback)", elastic: health?.checks?.find((c) => c.id === "elastic")?.mode ?? "unknown", database: "Postgres 17 in Docker on the same machine" },
    wallMs,
    requestsPerSecond: Number((totalReq / (wallMs / 1000)).toFixed(1)),
    results,
    ...(CHANGE && previous?.results
      ? (() => {
          const c = previous.results.find((r) => r.id === "claim");
          return c ? { before: { measuredAt: previous.measuredAt, change: CHANGE, claimP50: c.p50_ms, claimP95: c.p95_ms, worker: previous.server?.worker ?? "unknown" } } : {};
        })()
      : previous?.before && !CHANGE
        ? { before: previous.before }
        : {}),
    claim: {
      what: "For the claim path: the client time is from request start to the full answer and includes each job's wait in the queue; the server stage timings are the check itself, as verifyPhoto measured it inside the job.",
      alone: { clientMs: aloneMs, ok: alone.ok, server: aloneServer },
      serverStages: stages,
      queue,
    },
  };
  writeFileSync("content/public/load-test.json", JSON.stringify(out, null, 2) + "\n");
  for (const r of results) console.log(`${r.name}: ${r.requests} requests, p50 ${r.p50_ms} ms, p95 ${r.p95_ms} ms, p99 ${r.p99_ms} ms, max ${r.max_ms} ms, errors ${r.errors} (${(r.error_rate * 100).toFixed(1)}%) ${JSON.stringify(r.statuses)}`);
  console.log(`${totalReq} requests in ${(wallMs / 1000).toFixed(1)} s (${out.requestsPerSecond} a second); written to content/public/load-test.json`);

  if (!keep && claimIds.length && process.env.DATABASE_URL) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      const photos = await c.query("select photo_id from claim where id = any($1::uuid[])", [claimIds]);
      const photoIds = photos.rows.map((r) => r.photo_id).filter(Boolean);
      await c.query("delete from job where kind = 'verify_claim' and payload->>'claimId' = any($1::text[])", [claimIds]);
      await c.query("delete from claim where id = any($1::uuid[])", [claimIds]);
      if (photoIds.length) {
        await c.query("delete from image_hash where source = 'claim' and ref = any($1::text[])", [photoIds]);
        await c.query("delete from photo where id = any($1::uuid[])", [photoIds]);
      }
      console.log(`removed ${claimIds.length} test claims`);
    } finally {
      await c.end();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
