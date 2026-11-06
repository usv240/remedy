import { sql } from "drizzle-orm";
import { aiAvailable, aiPaused } from "./ai/claude";
import { db, dbConfigured } from "./db";
import { accessToken, paypalConfigured } from "./paypal/client";
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
export async function runChecks(): Promise<Check[]> {
  const [pp, database] = await Promise.all([
    paypalConfigured() ? timed(async () => (await accessToken()) && "Sandbox token issued; Payouts, Refunds and Orders v2 use it") : Promise.resolve(null),
    dbConfigured() ? timed(async () => (await db().execute(sql`select 1`)) && "Postgres answered a test query") : Promise.resolve(null),
  ]);
  const elastic = on("ELASTIC_URL", "FALLBACK_ELASTIC") && set("ELASTIC_API_KEY");
  const onRender = set("RENDER_EXTERNAL_URL");
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
      detail: `@bryntum/gantt ${pinned("@bryntum/gantt")}, the hackathon trial, which shows a trial watermark`,
    },
    {
      id: "ag-grid",
      name: "AG Grid and AG Studio",
      mode: set("NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY") ? "live" : "fallback",
      detail: set("NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY")
        ? `ag-grid-enterprise ${pinned("ag-grid-enterprise")} and ag-studio-react ${pinned("ag-studio-react")}, licensed`
        : `ag-grid-enterprise ${pinned("ag-grid-enterprise")} and ag-studio-react ${pinned("ag-studio-react")} on the trial; they show a licence notice until a key is set`,
    },
    {
      id: "kernel",
      name: "KERNEL cloud browser",
      mode: on("KERNEL_API_KEY", "FALLBACK_KERNEL") ? "live" : "fallback",
      detail: on("KERNEL_API_KEY", "FALLBACK_KERNEL") ? "Reads cpsc.gov recall pages and firm recall sites in a cloud browser" : "Recall pages are read with a plain fetch, without a cloud browser",
    },
    {
      id: "render",
      name: "Render",
      mode: onRender ? "live" : "fallback",
      detail: onRender ? "Hosting, Postgres and payout workflows on Render" : "Running locally; jobs run in this process instead of Render Workflows",
    },
    {
      id: "apimatic",
      name: "PayPal Server SDK (APIMatic)",
      mode: "live",
      detail: `@paypal/paypal-server-sdk ${pinned("@paypal/paypal-server-sdk")} creates, captures and refunds orders`,
    },
    { id: "database", name: "Postgres", mode: database?.ok ? "live" : "not_connected", detail: database ? database.detail : "DATABASE_URL not set", ms: database?.ms },
    {
      id: "checks",
      name: "Outside checks",
      // Live once the outside-checks workflow is deployed: its slug and the shared secret are both set.
      mode: set("CHECKS_SECRET") && set("CHECKS_WORKFLOW_SLUG") ? "live" : "not_connected",
      detail: set("CHECKS_SECRET") && set("CHECKS_WORKFLOW_SLUG") ? "A Render Workflow runs the judges' path and the public API from outside the app" : "Not set up on this server",
    },
  ];
}
