import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Info } from "@/components/Info";
import { OpsChart } from "@/components/ops/OpsChart";
import { OpsStream } from "@/components/ops/OpsStream";
import { OpsTrace } from "@/components/ops/OpsTrace";
import { CheckedAt } from "@/app/status/CheckedAt";
import { ago, runChecks } from "@/lib/health";
import { ai24h, alerts, decisions24h, feed, hourly7d, payments24h, rightNow, routes24h, webhooks24h } from "@/lib/ops/data";
import "../pages.css";
import "../developers/dev.css";
import "./ops.css";

export const metadata: Metadata = { title: "Operations", description: "Remedy watching itself, live: services, the job queue, latency and errors, payments and webhooks by status, and the event stream. Nothing private." };

const LABEL = { live: "Live", fallback: "Fallback", not_connected: "Not connected" } as const;
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const int = (n: number) => n.toLocaleString("en-US");

function Head({ id, title, proves, info }: { id: string; title: string; proves: string; info: string }) {
  return (
    <>
      <div className="title-row">
        <h2 id={id}>{title}</h2>
        <Info id={info} label="" topic={title} />
      </div>
      <p className="ops-proves">{proves}</p>
    </>
  );
}

async function RightNow() {
  await connection();
  const [checks, now] = await Promise.all([runChecks(), rightNow()]);
  const at = new Date().toISOString();
  const live = checks.filter((c) => c.mode === "live").length;
  const q = now.queue;
  const waiting = q ? q.queued + q.running : 0;
  const tiles = [
    { k: "Services live", v: `${live} of ${checks.length}`, s: "checked now" },
    { k: "Jobs waiting", v: int(waiting), s: waiting && q?.oldestWaitingSec ? `oldest ${q.oldestWaitingSec} s` : q?.failed ? `${q.failed} failed` : "none held up" },
    { k: "AI spend today", v: usd(now.ai.usd), s: Number.isFinite(now.ai.budget) ? `of ${usd(now.ai.budget)} cap` : "no cap locally" },
    { k: "Requests, last hour", v: int(now.requestsLastHour), s: now.errorsLastHour ? `${now.errorsLastHour} server errors` : "no server errors" },
  ];
  return (
    <>
      <ul className="ops-tiles">
        {tiles.map((t) => (
          <li key={t.k} className="ops-tile">
            <p className="ops-tile-k">{t.k}</p>
            <p className="ops-tile-v tabular">{t.v}</p>
            <p className="ops-tile-s muted">{t.s}</p>
          </li>
        ))}
      </ul>
      <p className="status-sum ops-sum">
        <span className="tabular">
          Checked at <CheckedAt iso={at} />.
        </span>{" "}
        Worker {now.workerFresh && q?.workerSeenAt ? `last seen ${ago(q.workerSeenAt)}` : "not running; routes run their jobs inline"}. Daily recall ingest{" "}
        {now.ingest?.lastOkAt ? `last ran ${ago(new Date(now.ingest.lastOkAt))}` : "has not run on this server yet"}.
      </p>
      <ul className="status-list ops-services">
        {checks.map((c) => (
          <li key={c.id} className="status-row">
            <span className="status-name">{c.name}</span>
            <span className="status-detail">
              {c.detail}
              {c.ms ? <span className="tabular"> in {c.ms} ms</span> : null}
            </span>
            <span className="status-mode" data-mode={c.mode}>
              {LABEL[c.mode]}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function CountList({ items }: { items: { label: string; count: number }[] }) {
  return (
    <ul className="ops-counts">
      {items.map((i) => (
        <li key={i.label}>
          <span>{i.label}</span>
          <span className="tabular">{int(i.count)}</span>
        </li>
      ))}
    </ul>
  );
}

async function LastDay() {
  await connection();
  const [routes, pays, hooks, decisions, ai] = await Promise.all([routes24h(), payments24h(), webhooks24h(), decisions24h(), ai24h()]);
  const total = routes.reduce((s, r) => s + r.count, 0);
  const errors = routes.reduce((s, r) => s + r.errors, 0);
  const aiTotal = ai.reduce((s, r) => s + r.usd, 0);
  return (
    <div className="ops-day">
      <div className="ops-block ops-block-wide">
        <h3>Requests by route</h3>
        <p className="muted tabular">
          {int(total)} requests, {int(errors)} server errors{total ? ` (${((errors / total) * 100).toFixed(2)}%)` : ""}.
        </p>
        {routes.length > 0 ? (
          <div className="ops-table-wrap" tabIndex={0} role="region" aria-label="Requests by route, scrollable">
            <table className="ops-table">
              <thead>
                <tr>
                  <th scope="col">Route</th>
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
                    Errors
                  </th>
                  <th scope="col" className="num ops-tech">
                    4xx
                  </th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.route}>
                    <th scope="row">{r.route}</th>
                    <td className="num tabular">{int(r.count)}</td>
                    <td className="num tabular">{int(r.p50)} ms</td>
                    <td className="num tabular">{int(r.p95)} ms</td>
                    <td className="num tabular" data-attention={r.errorRate > 0.05 ? "" : undefined}>
                      {r.errors ? `${r.errors} (${(r.errorRate * 100).toFixed(1)}%)` : "0"}
                    </td>
                    <td className="num tabular ops-tech">{int(r.clientErrors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No API requests logged yet today.</p>
        )}
      </div>
      <div className="ops-block">
        <h3>Payments by status</h3>
        <CountList items={pays} />
      </div>
      <div className="ops-block">
        <h3>Webhooks</h3>
        <CountList
          items={[
            { label: "Received and handled once", count: hooks.handled },
            { label: "Repeat deliveries, answered from the first", count: hooks.duplicates },
            { label: "Not verified, stored and ignored", count: hooks.untrusted },
          ]}
        />
        {hooks.byType.length > 0 && (
          <div className="ops-tech">
            <CountList items={hooks.byType.map((t) => ({ label: t.label.toLowerCase(), count: t.count }))} />
          </div>
        )}
      </div>
      <div className="ops-block">
        <h3>Photo decisions</h3>
        <CountList items={decisions} />
      </div>
      <div className="ops-block">
        <h3>AI calls by route</h3>
        <p className="muted tabular">{ai.length ? `${int(ai.reduce((s, r) => s + r.calls, 0))} calls, ${usd(aiTotal)}` : "No live Claude calls in the last day; replays and the verification cache cost nothing."}</p>
        {ai.length > 0 && (
          <ul className="ops-counts">
            {ai.map((r) => (
              <li key={r.route}>
                <span>
                  {r.route}
                  <span className="ops-tech muted">
                    {" "}
                    {int(r.inputTokens)} in, {int(r.cacheReadTokens)} cached, {int(r.outputTokens)} out
                  </span>
                </span>
                <span className="tabular">
                  {r.calls} {r.calls === 1 ? "call" : "calls"}, {usd(r.usd)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

async function Stream() {
  await connection();
  return <OpsStream initial={await feed()} />;
}

async function Chart() {
  await connection();
  return <OpsChart points={await hourly7d()} />;
}

async function Alerts() {
  await connection();
  const list = await alerts(await rightNow());
  const attention = list.filter((a) => !a.ok).length;
  return (
    <>
      <p className="status-sum ops-sum tabular">{attention ? `${attention} of ${list.length} need attention.` : `All ${list.length} fine.`}</p>
      <ul className="status-list">
        {list.map((a) => (
          <li key={a.id} className="status-row">
            <span className="status-name">
              {a.name}
              <span className="ops-rule muted"> {a.rule}</span>
            </span>
            <span className="status-detail">{a.detail}</span>
            <span className="status-mode" data-mode={a.ok ? "live" : "attention"}>
              {a.ok ? "Fine" : "Attention"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const TOC: [string, string][] = [
  ["#now", "Right now"],
  ["#day", "Last 24 hours"],
  ["#stream", "Live stream"],
  ["#week", "Over time"],
  ["#trace", "Trace a request"],
  ["#alerts", "Alerts"],
];

export default function OpsPage() {
  return (
    <div className="page frame ops">
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">Operations</h1>
          <Info id="page.ops" />
        </div>
        <p className="lede">Remedy watching itself, live. Read only, and nothing on it is private.</p>
        <p className="page-prose">
          The short version is on{" "}
          <Link className="text-link" href="/status">
            Status
          </Link>
          ; the load test and what a real deployment changes are on{" "}
          <Link className="text-link" href="/evidence#load">
            Evidence
          </Link>
          .
        </p>
      </header>

      <nav className="jp-toc ops-toc" aria-label="On this page">
        <ul>
          {TOC.map(([href, label]) => (
            <li key={href}>
              <a className="jp-toc-link" href={href}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="now" className="page-section" aria-labelledby="now-h">
        <Head id="now-h" title="Right now" proves="What this proves: every service is up or on its fallback, and nothing is piling up." info="ops.now" />
        <Suspense fallback={<p className="page-loading">Checking every service…</p>}>
          <RightNow />
        </Suspense>
      </section>

      <section id="day" className="page-section" aria-labelledby="day-h">
        <Head id="day-h" title="Last 24 hours" proves="What this proves: how fast the API answers, how often it fails, and where the money and the photos went, as counts." info="ops.day" />
        <Suspense fallback={<p className="page-loading">Counting the day…</p>}>
          <LastDay />
        </Suspense>
      </section>

      <section id="stream" className="page-section" aria-labelledby="stream-h">
        <Head id="stream-h" title="Live stream" proves="What this proves: the ledger and the request log are written as things happen, not after." info="ops.stream" />
        <Suspense fallback={<p className="page-loading">Opening the feed…</p>}>
          <Stream />
        </Suspense>
      </section>

      <section id="week" className="page-section" aria-labelledby="week-h">
        <Head id="week-h" title="Reliability over time" proves="What this proves: a week of traffic and errors, hour by hour, from the request log." info="ops.chart" />
        <Suspense fallback={<p className="page-loading">Drawing the week…</p>}>
          <Chart />
        </Suspense>
      </section>

      <section id="trace" className="page-section" aria-labelledby="trace-h">
        <Head id="trace-h" title="Trace a request" proves="What this proves: one request id follows a call from the API answer to the ledger entries it wrote." info="ops.trace" />
        <p className="page-prose">
          Every API error message ends with its request id, and every answer carries one in <code>meta.request_id</code>. Paste one here.
        </p>
        <OpsTrace />
      </section>

      <section id="alerts" className="page-section" aria-labelledby="alerts-h">
        <Head id="alerts-h" title="Alerts" proves="What this proves: the conditions a pager would watch, computed live, visible to anyone." info="ops.alerts" />
        <Suspense fallback={<p className="page-loading">Checking each condition…</p>}>
          <Alerts />
        </Suspense>
      </section>

      <p className="page-note ops-foot">Nothing on this page is private: no names, payees, photos, keys or addresses.</p>
    </div>
  );
}
