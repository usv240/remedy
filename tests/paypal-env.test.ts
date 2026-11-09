import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Environment } from "@paypal/paypal-server-sdk";
import { describe, expect, it } from "vitest";
import { sdkConfig, sdkEnvironment } from "@/lib/paypal/client";
import { GOING_LIVE, PAYPAL_HOSTS, paypalApiBase, paypalEnv, paypalJsSdkSrc, paypalMcpDefault } from "@/lib/paypal/env";
import { PAYPAL_TIMEOUT_MS } from "@/lib/paypal/http";

/**
 * One setting, PAYPAL_ENV, picks the PayPal every call uses: the REST base, the Server SDK's environment, the sample
 * shop's JavaScript SDK and PayPal's MCP server. The sandbox is the default, and only "live" moves off it. No PayPal
 * address is typed anywhere else in the app's code.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(f) ? [p] : [];
  });
}

describe("PAYPAL_ENV", () => {
  it("is the sandbox unless it says live", () => {
    expect(paypalEnv(undefined)).toBe("sandbox");
    expect(paypalEnv("")).toBe("sandbox");
    expect(paypalEnv("sandbox")).toBe("sandbox");
    expect(paypalEnv(" Live ")).toBe("live");
    // A typo or another word never moves real money.
    for (const v of ["prod", "production", "lve", "true"]) expect(paypalEnv(v)).toBe("sandbox");
  });

  it("moves every PayPal address and the Server SDK's environment together", () => {
    expect([paypalApiBase("sandbox"), paypalJsSdkSrc("sandbox"), paypalMcpDefault("sandbox")]).toEqual([
      "https://api-m.sandbox.paypal.com",
      "https://www.sandbox.paypal.com/web-sdk/v6/core",
      "https://mcp.sandbox.paypal.com",
    ]);
    expect([paypalApiBase("live"), paypalJsSdkSrc("live"), paypalMcpDefault("live")]).toEqual(["https://api-m.paypal.com", "https://www.paypal.com/web-sdk/v6/core", "https://mcp.paypal.com"]);
    expect(sdkEnvironment("sandbox")).toBe(Environment.Sandbox);
    expect(sdkEnvironment("live")).toBe(Environment.Production);
    for (const env of ["sandbox", "live"] as const) {
      const c = sdkConfig("id", "secret", env);
      expect(c.environment).toBe(sdkEnvironment(env));
      expect(c.timeout).toBe(PAYPAL_TIMEOUT_MS);
    }
  });

  it("reads process.env.PAYPAL_ENV when no value is passed", () => {
    const before = process.env.PAYPAL_ENV;
    try {
      process.env.PAYPAL_ENV = "live";
      expect(paypalApiBase()).toBe(PAYPAL_HOSTS.live.api);
      delete process.env.PAYPAL_ENV;
      expect(paypalApiBase()).toBe(PAYPAL_HOSTS.sandbox.api);
    } finally {
      if (before === undefined) delete process.env.PAYPAL_ENV;
      else process.env.PAYPAL_ENV = before;
    }
  });

  it("no PayPal address is typed anywhere else in the app's code", () => {
    const hosts = /api-m\.(sandbox\.)?paypal\.com|www\.(sandbox\.)?paypal\.com\/web-sdk|mcp\.(sandbox\.)?paypal\.com/;
    // The test fake answers with PayPal-shaped links, as PayPal does; it calls nothing.
    const allowed = new Set([path.join(ROOT, "src", "lib", "paypal", "env.ts"), path.join(ROOT, "src", "lib", "payments", "fake-paypal.ts")]);
    const typed = [...files(path.join(ROOT, "src")), ...files(path.join(ROOT, "scripts"))].filter((f) => !allowed.has(f) && hosts.test(read(path.relative(ROOT, f))));
    expect(typed.map((f) => path.relative(ROOT, f))).toEqual([]);
    // The Server SDK is never built with a fixed environment or without a timeout.
    for (const f of ["src/lib/paypal/client.ts", "src/lib/paypal/firm-account.ts"]) {
      const text = read(...f.split("/"));
      expect(text, f).not.toMatch(/environment: Environment\.(Sandbox|Production)|timeout: 0\b/);
    }
  });

  it(".env.example and render.yaml set it up, and /stack says what going live changes", () => {
    expect(read(".env.example")).toMatch(/^PAYPAL_ENV=sandbox$/m);
    const render = read("render.yaml");
    expect(render).toMatch(/- key: PAYPAL_ENV[^\n]*\n\s+value: sandbox/);
    expect(render.match(/key: PAYPAL_ENV/g)?.length).toBe(2);
    expect(read("src", "app", "stack", "page.tsx")).toContain("{GOING_LIVE}");
    expect(GOING_LIVE).toContain("PAYPAL_ENV=live");
    for (const what of ["REST API", "Server SDK", "JavaScript SDK", "MCP server", "client ID", "secret", "webhook ID"]) expect(GOING_LIVE).toContain(what);
    expect(read("src", "app", "stack", "page.tsx")).not.toMatch(/changes only the base URL/);
  });
});
