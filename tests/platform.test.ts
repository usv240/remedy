import { afterEach, describe, expect, it } from "vitest";
import { hashEvent, verifyChain } from "@/lib/audit";
import { fail, ok } from "@/lib/api/envelope";
import { ENDPOINTS } from "@/lib/api/endpoints";
import { KEY_PREFIX, displayPrefix, hashKey, newKey } from "@/lib/api/keys";
import { openapi } from "@/lib/api/openapi";
import { runChecks } from "@/lib/health";
import { serverCard } from "@/lib/mcp/card";
import { SERVER_INFO, TOOLS } from "@/lib/mcp/tools";

describe("API keys", () => {
  it("are rm_test_ plus 43 base62 characters, stored only as a SHA-256 hash", () => {
    const k = newKey();
    expect(KEY_PREFIX).toBe("rm_test_");
    expect(k).toMatch(/^rm_test_[0-9A-Za-z]{43}$/);
    expect(newKey()).not.toBe(k);
    expect(hashKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(displayPrefix(k)).toBe(k.slice(0, 12));
  });
});

describe("the API envelope", () => {
  it("has the same shape for answers and errors", async () => {
    const a = await ok({ x: 1 }, Date.now()).json();
    expect(a).toMatchObject({ data: { x: 1 }, error: null, meta: { version: expect.any(String) } });
    expect(a.meta.request_id).toMatch(/^req_[0-9a-f]{20}$/);
    const r = fail("not_found", "No such recall.", 404);
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ data: null, error: { code: "not_found", message: "No such recall.", docs: "/developers/docs#errors-not_found" } });
  });

  it("describes every endpoint in OpenAPI 3.1 as the Remedy API", () => {
    const spec = openapi("https://remedy.example");
    expect(spec.info.title).toBe("Remedy API");
    for (const e of ENDPOINTS) expect(spec.paths[e.path], e.id).toBeDefined();
    expect(JSON.stringify(spec)).not.toMatch(/giftwise|gw_test_/i);
  });
});

describe("the audit ledger", () => {
  const at = new Date("2026-11-05T12:00:00Z");
  const row = (id: number, prevHash: string, action: string) => {
    const e = { at: at.toISOString(), actor: "system", action, ref: `claim:${id}`, detail: { id } };
    return { id, at, actor: "system", action, ref: e.ref, detail: e.detail, prevHash, hash: hashEvent(prevHash, e) };
  };

  it("chains each event to the one before, and finds a changed one", () => {
    const a = row(1, "0".repeat(64), "claim.verified");
    const b = row(2, a.hash, "claim.paid");
    expect(verifyChain([a, b])).toEqual({ ok: true, count: 2 });
    expect(verifyChain([a, { ...b, detail: { id: 99 } }])).toEqual({ ok: false, count: 2, brokenAt: 2 });
  });
});

describe("the MCP server", () => {
  it("answers ping, and its card names Remedy", async () => {
    expect(SERVER_INFO.name).toBe("remedy");
    const ping = TOOLS.find((t) => t.name === "ping");
    expect(ping).toBeDefined();
    const r = await ping!.run({}, { origin: "https://remedy.example" });
    expect(r.data).toMatchObject({ ok: true, origin: "https://remedy.example" });
    expect(serverCard("https://remedy.example")).toMatchObject({ name: "io.github.usv240/remedy", remotes: [{ url: "https://remedy.example/api/mcp" }] });
  });
});

describe("health checks", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("report each integration as live, fallback or not connected from its settings", async () => {
    for (const k of ["DATABASE_URL", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "ANTHROPIC_API_KEY", "ELASTIC_URL", "ELASTIC_API_KEY", "CHANNEL3_API_KEY", "KERNEL_API_KEY", "RENDER_EXTERNAL_URL", "CHECKS_SECRET", "CHECKS_WORKFLOW_SLUG", "PAYPAL_WEBHOOK_ID", "NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY"]) delete process.env[k];
    const none = Object.fromEntries((await runChecks()).map((c) => [c.id, c.mode]));
    expect(none).toEqual({
      paypal: "not_connected",
      webhooks: "fallback",
      claude: "fallback",
      elastic: "fallback",
      channel3: "fallback",
      bryntum: "live",
      "ag-grid": "live",
      apimatic: "live",
      render: "fallback",
      database: "not_connected",
    });

    Object.assign(process.env, { ELASTIC_URL: "https://x", ELASTIC_API_KEY: "k", CHANNEL3_API_KEY: "k", RENDER_EXTERNAL_URL: "https://remedy.onrender.com" });
    const set = Object.fromEntries((await runChecks()).map((c) => [c.id, c.mode]));
    expect(set).toMatchObject({ elastic: "live", channel3: "live", render: "live" });

    process.env.FALLBACK_ELASTIC = "true";
    expect((await runChecks()).find((c) => c.id === "elastic")?.mode).toBe("fallback");
  });
});
