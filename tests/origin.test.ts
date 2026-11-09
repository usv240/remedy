import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin } from "@/lib/origin";

const saved = process.env.RENDER_EXTERNAL_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.RENDER_EXTERNAL_URL;
  else process.env.RENDER_EXTERNAL_URL = saved;
});

describe("publicOrigin", () => {
  it("uses Render's public address, not the internal port the proxy forwards to", () => {
    process.env.RENDER_EXTERNAL_URL = "https://remedy.onrender.com/";
    expect(publicOrigin(new Request("http://localhost:10000/api/webhooks/paypal"))).toBe("https://remedy.onrender.com");
  });

  it("uses the request's own origin off Render", () => {
    delete process.env.RENDER_EXTERNAL_URL;
    expect(publicOrigin(new Request("http://localhost:3300/openapi.json"))).toBe("http://localhost:3300");
  });
});

describe("sitemap.xml and robots.txt", () => {
  it("name the host the request came to, never a typed-in address", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/app/sitemap.ts", "src/app/robots.ts"]) {
      const text = readFileSync(f, "utf8");
      expect(text, f).toContain("await pageOrigin()");
      expect(text, f).not.toMatch(/HOSTED_URL } from|localhost:3300|onrender\.com/);
    }
  });
});
