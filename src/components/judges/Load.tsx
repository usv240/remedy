import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";

type LoadResult = { id: string; name: string; requests: number; p50_ms: number; p95_ms: number; p99_ms: number; max_ms: number; errors: number; error_rate: number };
type LoadFile = {
  measuredAt: string;
  users: number;
  method: string;
  machine: { platform: string; cpu: string; cores: number; memoryGb: number; node: string };
  server: { build: string; worker: string; elastic: string; database: string };
  wallMs: number;
  requestsPerSecond: number;
  results: LoadResult[];
};

/** content/public/load-test.json, written by scripts/load-test.mjs; absent until the test has run on this checkout. */
export function loadTest(): LoadFile | null {
  const f = path.join(process.cwd(), "content", "public", "load-test.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as LoadFile) : null;
}

const ms = (n: number) => `${n.toLocaleString("en-US")} ms`;

/** The load test's numbers, with the exact method and machine. */
export function Load() {
  const t = loadTest();
  if (!t) return <p className="muted">The load test has not been run on this build yet: node scripts/load-test.mjs writes content/public/load-test.json.</p>;
  const total = t.results.reduce((s, r) => s + r.requests, 0);
  const errors = t.results.reduce((s, r) => s + r.errors, 0);
  return (
    <>
      <p className="page-prose jp-intro tabular">
        {t.users} visitors at once, {total.toLocaleString("en-US")} requests in {(t.wallMs / 1000).toFixed(1)} s ({t.requestsPerSecond} a second), {errors} {errors === 1 ? "error" : "errors"}.
      </p>
      <div className="ops-table-wrap" tabIndex={0} role="region" aria-label="Load test results, scrollable">
        <table className="ops-table jl-table">
          <thead>
            <tr>
              <th scope="col">Path</th>
              <th scope="col" className="num">
                Requests
              </th>
              <th scope="col" className="num">
                p50
              </th>
              <th scope="col" className="num">
                p95
              </th>
              <th scope="col" className="num">
                p99
              </th>
              <th scope="col" className="num">
                Errors
              </th>
            </tr>
          </thead>
          <tbody>
            {t.results.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.name}</th>
                <td className="num tabular">{r.requests}</td>
                <td className="num tabular">{ms(r.p50_ms)}</td>
                <td className="num tabular">{ms(r.p95_ms)}</td>
                <td className="num tabular">{ms(r.p99_ms)}</td>
                <td className="num tabular">{r.errors ? `${r.errors} (${(r.error_rate * 100).toFixed(1)}%)` : "0"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="jx-disc">
        <summary>The method and the machine</summary>
        <div className="jx-body">
          <p className="page-prose">{t.method}</p>
          <p className="page-prose">
            Server: {t.server.build}, worker {t.server.worker}, recall search {t.server.elastic}, {t.server.database}. Machine: {t.machine.cpu}, {t.machine.cores} cores, {t.machine.memoryGb} GB, {t.machine.platform}, Node {t.machine.node}. Measured{" "}
            {new Date(t.measuredAt).toLocaleDateString("en-US", { dateStyle: "long" })}; the file is{" "}
            <code>content/public/load-test.json</code>.
          </p>
        </div>
      </details>
      <p className="page-note">
        Live latency by route, from the request log, is on{" "}
        <Link className="text-link" href="/ops#day">
          Operations
        </Link>
        .
      </p>
    </>
  );
}

/** What the demo runs on and what a real deployment changes, stated as an operating range. */
export const REAL: { part: string; demo: string; real: string }[] = [
  { part: "Web service", demo: "One Render Starter instance (0.5 CPU, 512 MB), always on, with the API and MCP server in the same process", real: "Two or more instances behind Render's load balancer, autoscaling on CPU, with the same code" },
  { part: "Checks and payouts", demo: "One background worker; a route runs its own job inline if no worker answers in 2 s", real: "Workers scaled with the queue depth shown on Operations; the same job table" },
  { part: "Database", demo: "A 256 MB Postgres with a 1 GB disk, reached only from this workspace", real: "A larger Postgres with a connection pooler, point-in-time recovery, and backups restored on a schedule to prove they work" },
  {
    part: "Your photo",
    demo: "Stored in Postgres as a 1,600 px copy with no camera or location (EXIF, GPS) data, the original cleared once checked. A photo that shows a person is deleted at once, and every owner's photo 90 days after the claim is decided; its hash is kept",
    real: "Object storage with signed URLs for upload and view, the same deletion rules, and the hash kept in Postgres",
  },
  { part: "AI", demo: "$2 of Claude a day; past it, photos go to a person at the firm", real: "A budget per firm, the Message Batches API for proof rules, and the same cache so a repeat photo costs nothing" },
  { part: "Firm console", demo: "Open, for the fictional sample firm", real: "Login and roles per firm (reviewer, compliance lead, read only), with every action in the ledger under a named person" },
  { part: "PayPal", demo: "Sandbox, one app, the hosted webhook plus event lookup for local servers", real: "A live app and a registered webhook per environment, with the same signature check" },
  { part: "Limits", demo: "20 API requests a minute without a key, 300 photo claims a day site-wide, each payment under $50", real: "Limits per firm and per key, set with the firm, counted in the same table" },
];

export function Real() {
  return (
    <div className="ops-table-wrap" tabIndex={0} role="region" aria-label="The demo today and a real deployment, scrollable">
      <table className="ops-table jl-table jl-real">
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">The demo today</th>
            <th scope="col">A real deployment</th>
          </tr>
        </thead>
        <tbody>
          {REAL.map((r) => (
            <tr key={r.part}>
              <th scope="row">{r.part}</th>
              <td data-k="The demo today">{r.demo}</td>
              <td data-k="A real deployment">{r.real}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
