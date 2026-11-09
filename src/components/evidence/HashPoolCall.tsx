import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { pageOrigin } from "@/lib/origin";
import "./hash-pool-call.css";

type Call = { step: string; why: string; command: string; status: number; ms: number; response: unknown };
type Recorded = { note: string; recordedAt: string; crossed: string[]; calls: Call[] };

/** content/public/hash-pool-call.json, written by scripts/public/record-hash-pool-call.ts, or null before it has been recorded. */
function recorded(): Recorded | null {
  const file = path.join(process.cwd(), "content", "public", "hash-pool-call.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Recorded;
  } catch {
    return null;
  }
}

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const TITLES: Record<string, string> = { register: "1. Brightline registers the hash", "check-hit": "2. Fernway asks about the same photo", "check-no-hit": "3. Fernway asks about a photo of a mug" };

/** The calls with this server's own address (the request's host, or Render's public one): src/lib/origin.ts. */
export async function HashPoolCallLive() {
  return <HashPoolCall host={await pageOrigin()} />;
}

/**
 * Another firm joining the pool from outside the app: the three recorded curl calls (register, a hit, no hit) with
 * their answers, for /evidence#network. Only the hash and an opaque ref cross, and the file says so. The calls were
 * recorded against a local build; each command is printed with the address of the server showing it, as /developers
 * prints its examples, so it runs as shown. Before the host is known, the same command with the path alone.
 */
export function HashPoolCall({ host }: { host: string | null }) {
  const r = recorded();
  if (!r?.calls.length) return null;
  const data = (c: Call) => (c.response as { data?: Record<string, unknown> }).data ?? c.response;
  const here = (command: string) => command.replace(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/g, host ?? "");
  return (
    <div className="ev-pool">
      <p className="page-prose">
        Any firm can join the same check through two documented calls, from its own systems: register the hash of a photo it has paid on, and ask about a hash before it pays. Here are three real calls made with <code>curl</code> from outside the app on{" "}
        {day(r.recordedAt)}, with their answers as the server gave them. They were recorded against a local build of this code; each command is printed with this server&rsquo;s address, so it runs as shown.
      </p>
      <ol className="ev-pool-calls" aria-label="Three recorded calls to the hash pool">
        {r.calls.map((c) => (
          <li key={c.step} className="ev-pool-call" data-ui>
            <p className="ev-pool-k">{TITLES[c.step] ?? c.step}</p>
            <p className="ev-pool-why">{c.why}</p>
            <pre className="ev-pool-pre" tabIndex={0} aria-label={`${c.step}: the request`}>
              {here(c.command)}
            </pre>
            <p className="ev-pool-meta tabular">
              {c.status} in {c.ms} ms
            </p>
            <pre className="ev-pool-pre ev-pool-out" tabIndex={0} aria-label={`${c.step}: the answer`}>
              {JSON.stringify(data(c), null, 2)}
            </pre>
          </li>
        ))}
      </ol>
      <p className="page-note">
        What crossed: {r.crossed.map((f) => (f === "dhash" ? "the 64-bit hash" : f === "ref" ? "an opaque ref that opens nothing and names no firm" : f)).join(" and ")}. The register call carried a sandbox API key, masked here and not written to the row. Recorded by
        scripts/public/record-hash-pool-call.ts into content/public/hash-pool-call.json; tests/hash-pool.test.ts checks the same comparison with no database. Both endpoints are in the{" "}
        <Link className="text-link" href="/developers/docs#hash-pool-check">
          API docs
        </Link>
        .
      </p>
    </div>
  );
}
