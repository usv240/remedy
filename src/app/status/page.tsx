import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Info } from "@/components/Info";
import { dailyBudgetUsd, spendByRouteToday, spendToday } from "@/lib/ai/usage";
import { liveSummary, MODE_LABEL, runChecks } from "@/lib/health";
import { CheckedAt } from "./CheckedAt";
import "../pages.css";
import "./status.css";

export const metadata: Metadata = { title: "Status", description: "Every service Remedy uses, and whether it is live, on its fallback, or an optional add-on that is off." };

/** The Info entry that explains each service, when it is not stack.<id>. */
const INFO: Record<string, string> = { database: "postgres", webhooks: "paypal", "error-tracking": "error-tracking", queue: "queue", worker: "worker" };

async function Rows() {
  await connection();
  const checks = await runChecks();
  const at = new Date().toISOString();
  const sum = liveSummary(checks);
  return (
    <>
      <p className="status-sum">
        <span className="tabular">
          {sum.live} of {sum.of} services live{sum.optionalOff ? `, ${sum.optionalOff} optional ${sum.optionalOff === 1 ? "add-on" : "add-ons"} off` : ""}, checked at <CheckedAt iso={at} />.
        </span>{" "}
        <a className="text-link" href="/status">
          Check again
        </a>
      </p>
      <ul className="status-list">
        {checks.map((c) => (
          <li key={c.id} className="status-row">
            <span className="status-name">
              {c.name} <Info id={`stack.${INFO[c.id] ?? c.id}`} label="" />
            </span>
            <span className="status-detail">
              {c.detail}
              {c.ms ? <span className="tabular"> in {c.ms} ms</span> : null}
            </span>
            <span className="status-mode" data-mode={c.mode}>
              {MODE_LABEL[c.mode]}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** Claude spend today from the ai_usage log, against the daily budget. Rendered always; shown in Technical view only. */
async function AiSpend() {
  await connection();
  const [today, routes] = await Promise.all([spendToday(), spendByRouteToday()]);
  const budget = dailyBudgetUsd();
  return (
    <section className="status-ai" aria-labelledby="status-ai-title">
      <div className="title-row">
        <h2 id="status-ai-title">AI spend today</h2>
        <Info id="status.ai_spend" label="" topic="AI spend today" />
      </div>
      <p className="status-sum tabular">
        {usd(today.usd)} of {Number.isFinite(budget) ? `${usd(budget)} a day (AI_DAILY_USD)` : "no daily limit on this machine"}, UTC day, from the ai_usage log
        {today.source === "memory" ? " (this process only: no database)" : ""}.
      </p>
      {routes.length > 0 && (
        <ul className="status-list">
          {routes.map((r) => (
            <li key={r.route} className="status-row">
              <span className="status-name">{r.route}</span>
              <span className="status-detail tabular">
                {r.calls} {r.calls === 1 ? "call" : "calls"}, {r.inputTokens.toLocaleString("en-US")} input, {r.cacheReadTokens.toLocaleString("en-US")} cache read, {r.outputTokens.toLocaleString("en-US")} output tokens
              </span>
              <span className="status-mode tabular">{usd(r.usd)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function StatusPage() {
  return (
    <div className="page frame">
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">Status</h1>
          <Info id="page.status" />
        </div>
        <p className="lede">Every service Remedy uses, checked when you open this page. When a service is not connected, Remedy uses its fallback so every flow still works.</p>
        <p className="page-prose">
          <Link className="text-link" href="/ops">
            Operations
          </Link>{" "}
          shows the same checks live, with request latency, the job queue, payments by status and the event stream.
        </p>
      </header>
      <Suspense fallback={<p className="page-loading">Checking every service…</p>}>
        <Rows />
      </Suspense>
      <Suspense fallback={null}>
        <AiSpend />
      </Suspense>
    </div>
  );
}
