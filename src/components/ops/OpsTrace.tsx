"use client";

import { useId, useState } from "react";
import type { Trace } from "@/lib/ops/data";

const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

/** Paste a request id from any API answer; see its log lines and the ledger entries it wrote. */
export function OpsTrace() {
  const id = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);

  async function run() {
    const q = value.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/ops/trace?id=${encodeURIComponent(q)}`).catch(() => null);
    const j = r ? ((await r.json().catch(() => null)) as { data: Trace | null; error: { message: string } | null } | null) : null;
    setBusy(false);
    if (!j?.data) {
      setError(j?.error?.message ?? "The trace could not be read just now. Please try again.");
      setTrace(null);
      return;
    }
    setTrace(j.data);
  }

  return (
    <div className="ops-trace">
      <form
        className="ops-trace-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="dev-field ops-trace-field">
          <span>Request id</span>
          <input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder="req_3f2a9c1e7b4d2a1c9e0f" spellCheck={false} autoComplete="off" inputMode="text" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy ? "Looking" : "Trace"}
        </button>
      </form>
      {error && (
        <p className="ops-trace-error" role="alert">
          {error}
        </p>
      )}
      {trace && (
        <div className="ops-trace-out" aria-live="polite">
          <p className="tabular">
            <strong>{trace.requestId}</strong>: {trace.requests.length} {trace.requests.length === 1 ? "request" : "requests"}, {trace.ledger.length} ledger {trace.ledger.length === 1 ? "entry" : "entries"}.
          </p>
          {!trace.requests.length && !trace.ledger.length && <p className="muted">Nothing logged under that id. Request ids are kept for 7 days; the ledger is kept for good.</p>}
          {trace.requests.length > 0 && (
            <ol className="ops-events">
              {trace.requests.map((r, i) => (
                <li key={i} className="ops-ev" data-kind="request" data-status={r.status >= 500 ? "error" : r.status >= 400 ? "client" : "ok"}>
                  <time className="ops-ev-time tabular" dateTime={r.at}>
                    {fmt(r.at)}
                  </time>
                  <span className="ops-ev-what">
                    <span className="ops-ev-tag">request</span> {r.route}
                  </span>
                  <span className="ops-ev-meta tabular">
                    {r.status} in {r.ms} ms
                  </span>
                </li>
              ))}
            </ol>
          )}
          {trace.ledger.length > 0 && (
            <ol className="ops-events">
              {trace.ledger.map((l, i) => (
                <li key={i} className="ops-ev" data-kind="ledger">
                  <time className="ops-ev-time tabular" dateTime={l.at}>
                    {fmt(l.at)}
                  </time>
                  <span className="ops-ev-what">
                    <span className="ops-ev-tag">ledger</span> {l.action}
                  </span>
                  <span className="ops-ev-meta tabular">
                    {l.actor} {l.ref}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
