import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { clientId } from "@/lib/api/keys";
import { addressSource, clientAddress, clientIp, clientKey } from "@/lib/ratelimit";

/**
 * The caller's address for every per-client limit. Behind Cloudflare and Render's proxy, cf-connecting-ip is the address
 * that reached the proxy; the leftmost X-Forwarded-For entry is whatever the caller sent, so it is read only when no
 * proxy header is there (a local run). /api/health names the header the address came from, never the address.
 */
// The route awaits next/server's connection(), which needs a live request scope; outside Next it is a no-op here.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const req = (headers: Record<string, string>) => new Request("http://remedy.test/api/health", { headers });
const SPOOF = "203.0.113.7";
const REAL = "198.51.100.23";

describe("the caller's address", () => {
  it("ignores a spoofed X-Forwarded-For when cf-connecting-ip is present", () => {
    const r = req({ "x-forwarded-for": `${SPOOF}, ${REAL}`, "cf-connecting-ip": REAL });
    expect(clientAddress(r)).toEqual({ ip: REAL, from: "cf-connecting-ip" });
    expect(clientIp(r)).toBe(REAL);
    // A caller who changes only X-Forwarded-For keeps the same limit bucket.
    const other = req({ "x-forwarded-for": "192.0.2.99", "cf-connecting-ip": REAL });
    expect(clientKey(clientIp(other))).toBe(clientKey(clientIp(r)));
    expect(clientId(other)).toBe(clientId(r));
  });

  it("falls back in order: cf-connecting-ip, true-client-ip, the leftmost X-Forwarded-For, x-real-ip, then local", () => {
    expect(clientAddress(req({ "true-client-ip": REAL, "x-forwarded-for": SPOOF, "x-real-ip": "192.0.2.1" }))).toEqual({ ip: REAL, from: "true-client-ip" });
    expect(clientAddress(req({ "cf-connecting-ip": REAL, "true-client-ip": "192.0.2.5" }))).toEqual({ ip: REAL, from: "cf-connecting-ip" });
    // Local runs and tests that set X-Forwarded-For keep working as before.
    expect(clientAddress(req({ "x-forwarded-for": ` ${SPOOF} , 10.0.0.1`, "x-real-ip": "192.0.2.1" }))).toEqual({ ip: SPOOF, from: "x-forwarded-for" });
    expect(clientAddress(req({ "x-real-ip": "192.0.2.1" }))).toEqual({ ip: "192.0.2.1", from: "x-real-ip" });
    expect(clientAddress(req({}))).toEqual({ ip: "local", from: "none" });
    // An empty proxy header is no address: the next one is read.
    expect(clientAddress(req({ "cf-connecting-ip": " ", "x-forwarded-for": SPOOF }))).toEqual({ ip: SPOOF, from: "x-forwarded-for" });
  });

  it("is read in one place: the API key guard and the claims route call clientIp", () => {
    const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8");
    for (const f of [["src", "lib", "api", "keys.ts"], ["src", "app", "api", "claims", "route.ts"]]) {
      const text = read(...f);
      expect(text, f.join("/")).toContain("clientIp(req)");
      expect(text, f.join("/")).not.toMatch(/x-forwarded-for/i);
    }
  });

  it("/api/health names the header the address came from, and never the address", async () => {
    expect(addressSource(req({ "cf-connecting-ip": REAL, "x-forwarded-for": SPOOF }))).toEqual({ client_address_from: "cf-connecting-ip", note: "client address from: cf-connecting-ip" });
    const res = await health(req({ "cf-connecting-ip": REAL, "x-forwarded-for": `${SPOOF}, ${REAL}`, "x-real-ip": "192.0.2.1" }));
    const text = await res.text();
    const body = JSON.parse(text) as { request: { client_address_from: string; note: string } };
    expect(body.request.client_address_from).toBe("cf-connecting-ip");
    expect(body.request.note).toBe("client address from: cf-connecting-ip");
    for (const ip of [REAL, SPOOF, "192.0.2.1"]) expect(text).not.toContain(ip);
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  }, 30_000);
});
