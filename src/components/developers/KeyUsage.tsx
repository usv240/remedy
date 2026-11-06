"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Key = { id: number; prefix: string; name: string; created_at: string; last_used_at: string | null; revoked: boolean; calls_24h: number };
type Req = { endpoint: string; status: number; ms: number; at: string; prefix: string };
type Usage = { keys: Key[]; requests: Req[]; days: { day: string; n: number }[] };

const when = (s: string) => new Date(s).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** This browser's keys: usage over seven days, the last 20 calls, and rotate or revoke. */
export function KeyUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/keys", { cache: "no-store" });
    const j = await r.json();
    setUsage(j.data);
  }, []);

  useEffect(() => {
    // Usage comes from the server on mount; there is nothing to render before it arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(id: number, what: "revoke" | "rotate") {
    setNote("");
    const r = await fetch(`/api/keys/${id}/${what}`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) return setNote(j.error?.message ?? "That did not work. Please try again.");
    if (what === "rotate") setFresh(j.data.key);
    else setNote(`Key ${j.data.id} revoked. It stops working right away.`);
    load();
  }

  if (!usage) return <p className="page-loading">Loading your keys…</p>;
  if (usage.keys.length === 0) {
    return (
      <section className="page-section" aria-labelledby="keys-h">
        <h2 id="keys-h">Keys</h2>
        <div className="usage-empty">
          <p>No keys in this browser yet. Once you get a sandbox key, it shows here with its calls.</p>
          <Link className="btn btn-primary" href="/developers#key-h">
            Get a free sandbox key
          </Link>
        </div>
      </section>
    );
  }

  const max = Math.max(1, ...usage.days.map((d) => d.n));
  return (
    <>
      {fresh && (
        <div className="dev-reveal page-section" data-ui role="status">
          <p className="dev-reveal-k">Your new key</p>
          <code className="dev-key tabular">{fresh}</code>
          <p className="dev-reveal-note">The old key no longer works. This is the only time the new key is shown.</p>
        </div>
      )}
      {note && (
        <p className="page-section dev-note" role="status">
          {note}
        </p>
      )}
      <section className="page-section" aria-labelledby="keys-h">
        <h2 id="keys-h">Keys</h2>
        <ul className="usage-keys">
          {usage.keys.map((k) => (
            <li key={k.id} className="usage-key" data-ui data-revoked={k.revoked ? "" : undefined}>
              <div>
                <p className="tabular usage-prefix">{k.prefix}…</p>
                <p className="muted">
                  {k.name}. Created {when(k.created_at)}. {k.last_used_at ? `Last used ${when(k.last_used_at)}.` : "Not used yet."}
                </p>
              </div>
              <p className="tabular usage-calls">{k.calls_24h} calls in 24 hours</p>
              {k.revoked ? (
                <p className="usage-state">Revoked</p>
              ) : (
                <div className="usage-actions">
                  <button type="button" className="btn btn-quiet" onClick={() => act(k.id, "rotate")}>
                    Rotate
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => act(k.id, "revoke")}>
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="page-section" aria-labelledby="days-h">
        <h2 id="days-h">Calls per day</h2>
        {usage.days.length === 0 ? (
          <p className="muted">No calls yet. Send one from the playground.</p>
        ) : (
          <ol className="usage-days">
            {usage.days.map((d) => (
              <li key={d.day}>
                <span className="tabular">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                <span className="usage-bar" style={{ inlineSize: `${(d.n / max) * 100}%` }} aria-hidden="true" />
                <span className="tabular">{d.n}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="page-section" aria-labelledby="reqs-h">
        <h2 id="reqs-h">Last 20 requests</h2>
        {usage.requests.length === 0 ? (
          <p className="muted">No requests yet.</p>
        ) : (
          <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="Last 20 requests">
            <table className="doc-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Status</th>
                  <th scope="col">Time taken</th>
                  <th scope="col">Key</th>
                </tr>
              </thead>
              <tbody>
                {usage.requests.map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
                    <td className="tabular">{when(r.at)}</td>
                    <td className="tabular">{r.endpoint}</td>
                    <td className="tabular">{r.status}</td>
                    <td className="tabular">{r.ms} ms</td>
                    <td className="tabular">{r.prefix}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
