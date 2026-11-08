import { sql } from "drizzle-orm";
import { aiAvailable, aiPaused } from "./ai/claude";
import { db, dbConfigured } from "./db";
import { queueStats, WORKER_STALE_MS } from "./jobs/queue";
import { accessToken, paypalConfigured } from "./paypal/client";
import { lastRun } from "./recall/daily";
import { sentryEnvironment, sentryRelease } from "./sentry";
import pkg from "../../package.json";

/** Versions as the project pins them; "npm:@bryntum/gantt-trial@7.3.8" reads as 7.3.8. */
export const pinned = (name: string) => String((pkg.dependencies as Record<string, string>)[name] ?? "").replace(/^.*@/, "").replace(/^[~^]/, "");

export type Mode = "live" | "fallback" | "not_connected";
export type Check = { id: string; name: string; mode: Mode; detail: string; ms?: number };

const set = (name: string) => Boolean(process.env[name]?.trim());
/** A key is set and its FALLBACK_<NAME> switch is not forcing the fallback. */
const on = (name: string, fallbackSwitch?: string) => set(name) && !(fallbackSwitch && process.env[fallbackSwitch] === "true");

async function timed(fn: () => Promise<string>): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t = Date.now();
  try {
    const detail = await Promise.race([fn(), new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timed out")), 8000))]);
    return { ok: true, detail, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "failed", ms: Date.now() - t };
  }
}

/**
 * Every integration Remedy uses, each live, on its fallback, or not connected. PayPal and Postgres answer a real call;
 * the others are read from their environment variables, so this stays fast enough for Render's health check.
 */
/** "12 s ago", "3 min ago", "2 h ago". */
export function ago(at: Date, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** The job queue and worker rows, shared by /status, /ops and /api/health. */
export async function queueChecks(): Promise<Check[]> {
  const q = dbConfigured() ? await queueStats().catch(() => null) : null;
  const now = Date.now();
  const workerFresh = Boolean(q?.workerSeenAt && now - q.workerSeenAt.getTime() < WORKER_STALE_MS);
  const waiting = q ? q.queued + q.running : 0;
  const oldest = q?.oldestWaitingSec ?? null;
  return [
    {
      id: "queue",
      name: "Job queue",
      mode: !q ? "not_connected" : q.failed > 0 ? "fallback" : "live",
      detail: !q
        ? "DATABASE_URL not set"
        : `${waiting} ${waiting === 1 ? "job" : "jobs"} waiting${oldest !== null && waiting ? `, oldest ${oldest} s` : ""}; ${q.doneToday} done in the last day${q.failed ? `; ${q.failed} ${q.failed === 1 ? "job needs" : "jobs need"} a person (failed after 5 tries)` : ""}`,
    },
    {
      id: "worker",
      name: "Worker",
      mode: workerFresh ? "live" : "fallback",
      detail: workerFresh ? `Worker ${q!.workerName ?? ""} last seen ${ago(q!.workerSeenAt!, now)}; checks and payouts run off the request path` : q?.workerSeenAt ? `Checks and payouts run inside each request; the worker last reported in ${ago(q.workerSeenAt, now)}` : "Checks and payouts run inside each request, after a 2 s wait for a worker. The worker service in render.yaml (or npm run worker) takes them off the request path",
    },
  ];
}

export async function runChecks(): Promise<Check[]> {
  const [pp, database, ingest, queue] = await Promise.all([
    paypalConfigured() ? timed(async () => (await accessToken()) && "Sandbox token issued; Payouts, Refunds and Orders v2 use it") : Promise.resolve(null),
    dbConfigured() ? timed(async () => (await db().execute(sql`select 1`)) && "Postgres answered a test query") : Promise.resolve(null),
    lastRun().catch(() => null),
    queueChecks(),
  ]);
  const ingestFresh = Boolean(ingest?.lastOkAt && Date.now() - new Date(ingest.lastOkAt).getTime() < 48 * 3600_000);
  const elastic = on("ELASTIC_URL", "FALLBACK_ELASTIC") && set("ELASTIC_API_KEY");
  const onRender = set("RENDER_EXTERNAL_URL");
  const sentry = set("SENTRY_DSN");
  return [
    {
      id: "paypal",
      name: "PayPal sandbox (Payouts, Orders)",
      mode: pp?.ok ? "live" : "not_connected",
      detail: pp ? pp.detail : "Sandbox credentials not set; refunds cannot be sent",
      ms: pp?.ms,
    },
    {
      id: "webhooks",
      name: "PayPal webhooks",
      mode: set("PAYPAL_WEBHOOK_ID") ? "live" : "fallback",
      detail: set("PAYPAL_WEBHOOK_ID") ? "Every event is signature-checked with PayPal before it updates a payment" : "Webhook ID not set; payout statuses are read by polling PayPal instead",
    },
    {
      id: "claude",
      name: "Claude Opus 5.5",
      mode: aiAvailable() ? "live" : "fallback",
      detail: aiAvailable()
        ? "API key set; proof rules, photo checks and the two reviewers are live"
        : aiPaused()
          ? "The API is not taking requests from this account just now; photo checks go to a person at the firm"
          : "No API key; saved proof rules are shown and photo checks go to a person at the firm",
    },
    {
      id: "elastic",
      name: "Elastic recall search",
      mode: elastic ? "live" : "fallback",
      detail: elastic ? "Hybrid keyword and semantic search over every recall since 2024" : "Recall search uses the in-app keyword search until ELASTIC_URL and ELASTIC_API_KEY are set",
    },
    {
      id: "channel3",
      name: "Channel3 product search",
      mode: set("CHANNEL3_API_KEY") ? "live" : "fallback",
      detail: set("CHANNEL3_API_KEY") ? "Key set; safe replacements come from real products, each checked against active recalls" : "No key; owners are offered a refund instead of a replacement",
    },
    {
      id: "bryntum",
      name: "Bryntum Gantt",
      mode: "live",
      detail: `@bryntum/gantt ${pinned("@bryntum/gantt")}, the trial build, which shows a trial watermark`,
    },
    {
      id: "ag-grid",
      name: "AG Grid",
      mode: "live",
      detail: `ag-grid-enterprise ${pinned("ag-grid-enterprise")} for the claims queue, on the trial, which shows a license notice`,
    },
    {
      id: "apimatic",
      name: "PayPal Server SDK (APIMatic)",
      mode: "live",
      detail: `@paypal/paypal-server-sdk ${pinned("@paypal/paypal-server-sdk")} carries every order, capture and refund`,
    },
    {
      id: "render",
      name: "Render",
      mode: onRender ? "live" : "fallback",
      detail: onRender ? "Hosting and Postgres on Render" : "Running locally, not on Render",
    },
    { id: "database", name: "Postgres", mode: database?.ok ? "live" : "not_connected", detail: database ? database.detail : "DATABASE_URL not set", ms: database?.ms },
    ...queue,
    {
      id: "error-tracking",
      name: "Error tracking",
      mode: sentry ? "live" : "not_connected",
      detail: sentry ? `Sentry receives server, edge and browser errors with personal data scrubbed; release ${sentryRelease()?.slice(0, 7) ?? "unset"}, environment ${sentryEnvironment()}` : "Not connected: SENTRY_DSN is not set, so errors stay in the structured log only",
    },
    {
      id: "recall-ingest",
      name: "Daily recall ingest: last run",
      mode: ingestFresh ? "live" : "fallback",
      detail: ingest?.lastOkAt
        ? `${ingest.detail}${ingestFresh ? "" : " Serving the stored recall data until the next daily run."}`
        : ingest?.lastError
          ? `Serving the stored recall data; the next daily run tries again (last run: ${ingest.lastError}).`
          : "Serving the recall data loaded at deploy. The daily job in render.yaml adds each day's new recalls at 14:20 UTC.",
      ms: ingest?.lastMs ?? undefined,
    },
  ];
}
