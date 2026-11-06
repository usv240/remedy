import { afterEach, describe, expect, it } from "vitest";
import { withRequestIdSuffix, fail } from "@/lib/api/envelope";
import { currentRequestId, log, mask, requestIdFrom, runWithRequest, setLogSink, withRequest } from "@/lib/log";
import { scrubEvent } from "@/lib/sentry";

describe("the logger masks personal data", () => {
  it("masks emails, phone numbers and long digit runs inside strings", () => {
    expect(mask("payee jordan.lee@example.com asked")).toBe("payee j•••@example.com asked");
    expect(mask("call (415) 555-0134 today")).toBe("call •••-•••-0134 today");
    expect(mask("card 4111 1111 1111 1111")).toBe("card •••-•••-1111");
    // Short numbers (an amount, a recall number, a year) are left alone.
    expect(mask("recall 27056 refund 34.99 in 2026")).toBe("recall 27056 refund 34.99 in 2026");
  });

  it("drops photo bytes, data URIs and long blobs", () => {
    expect(mask(Buffer.alloc(1200))).toBe("[1200 bytes]");
    expect(mask({ photo: Buffer.alloc(5) })).toEqual({ photo: "[5 bytes]" });
    expect(mask({ bytes: "x".repeat(300) })).toEqual({ bytes: "[300 chars]" });
    expect(mask(`data:image/jpeg;base64,${"A".repeat(40)}`)).toBe("[image data]");
    expect(mask("A".repeat(150))).toBe("[150 chars]");
    expect(String(mask("x".repeat(5000)))).toBe("[5000 chars]");
  });

  it("redacts secret-looking keys and Remedy API keys", () => {
    expect(mask({ api_key: "abc", authorization: "Bearer x", token: "t", password: "p", name: "Ana" })).toEqual({ api_key: "[redacted]", authorization: "[redacted]", token: "[redacted]", password: "[redacted]", name: "Ana" });
    expect(mask("key rm_test_ABCDEFGHIJKLMNOP")).toBe("key rm_test_ABCD…");
  });

  it("reduces errors to name, message and a short stack, masked", () => {
    const e = new Error("could not pay a@b.co");
    const m = mask(e) as { name: string; message: string; stack: string };
    expect(m.name).toBe("Error");
    expect(m.message).toBe("could not pay a•••@b.co");
    expect(m.stack.split("\n").length).toBeLessThanOrEqual(6);
  });

  it("walks nested objects and arrays and stops at depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
    expect(JSON.stringify(mask(deep))).toContain("[deep]");
    expect(mask([{ email: "x@y.org" }])).toEqual([{ email: "x•••@y.org" }]);
  });
});

describe("the logger writes one JSON line with the request context", () => {
  const lines: { level: string; line: string }[] = [];
  afterEach(() => {
    lines.length = 0;
    setLogSink(null);
  });

  it("carries request_id and route inside withRequest, and sets x-request-id on the response", async () => {
    setLogSink((level, line) => lines.push({ level, line }));
    const req = new Request("http://localhost/api/x", { headers: { "x-request-id": "req_given_123456" } });
    const res = await withRequest(req, "GET /api/x", async () => {
      log.info("inside", { payee: "jo@example.com", claim_id: "c1" });
      expect(currentRequestId()).toBe("req_given_123456");
      return Response.json({ ok: true });
    });
    expect(res.headers.get("x-request-id")).toBe("req_given_123456");
    const inside = JSON.parse(lines[0].line);
    expect(inside).toMatchObject({ level: "info", msg: "inside", request_id: "req_given_123456", route: "GET /api/x", payee: "j•••@example.com", claim_id: "c1" });
    expect(typeof inside.ts).toBe("string");
    const done = JSON.parse(lines[1].line);
    expect(done).toMatchObject({ msg: "request", status: 200, route: "GET /api/x" });
    expect(typeof done.ms).toBe("number");
  });

  it("logs a thrown handler as a 500 and rethrows", async () => {
    setLogSink((level, line) => lines.push({ level, line }));
    await expect(withRequest(new Request("http://localhost/api/y"), "GET /api/y", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(lines.some((l) => l.level === "error" && JSON.parse(l.line).msg === "request failed")).toBe(true);
    expect(JSON.parse(lines.at(-1)!.line)).toMatchObject({ msg: "request", status: 500 });
  });

  it("makes a fresh id when the caller's x-request-id is not a plain token", () => {
    expect(requestIdFrom(new Request("http://x/", { headers: { "x-request-id": "<script>" } }))).toMatch(/^req_[0-9a-f]{20}$/);
    expect(requestIdFrom(new Request("http://x/"))).toMatch(/^req_[0-9a-f]{20}$/);
  });

  it("never prints a secret value even when asked to", () => {
    setLogSink((level, line) => lines.push({ level, line }));
    log.warn("x", { PAYPAL_CLIENT_SECRET: "shh-secret-value", nested: { apiKey: "k" } });
    expect(lines[0].line).not.toContain("shh-secret-value");
    expect(JSON.parse(lines[0].line)).toMatchObject({ PAYPAL_CLIENT_SECRET: "[redacted]", nested: { apiKey: "[redacted]" } });
  });
});

describe("the API envelope and the request id", () => {
  it("ends every error message with the request id and uses the request's id inside a request", async () => {
    expect(withRequestIdSuffix("No such recall.", "req_1")).toBe("No such recall. Request id: req_1");
    expect(withRequestIdSuffix("Already there. Request id: req_1", "req_1")).toBe("Already there. Request id: req_1");
    const body = await runWithRequest({ requestId: "req_ctx_1234", route: "GET /x" }, () => fail("not_found", "No such recall.", 404)).json();
    expect(body.meta.request_id).toBe("req_ctx_1234");
    expect(body.error.message).toBe("No such recall. Request id: req_ctx_1234");
  });
});

describe("the Sentry scrubber", () => {
  it("masks messages, exception values and breadcrumbs, and drops request bodies, cookies and the user", () => {
    const ev = scrubEvent({
      message: "mail to a@b.com",
      exception: { values: [{ type: "Error", value: "phone 4155550134 failed" }] },
      breadcrumbs: [{ message: "sent to c@d.org", data: { email: "e@f.io" } }],
      user: { id: "u1", email: "g@h.com" },
      request: { method: "POST", url: "https://x/api/claims?secret=1", cookies: { a: "b" }, data: { photo: "..." }, headers: { authorization: "k" } },
      server_name: "box",
    } as unknown as Parameters<typeof scrubEvent>[0]);
    expect(ev.message).toBe("mail to a•••@b.com");
    expect(ev.exception?.values?.[0].value).toBe("phone •••-•••-0134 failed");
    expect(ev.breadcrumbs?.[0]).toMatchObject({ message: "sent to c•••@d.org", data: { email: "e•••@f.io" } });
    expect(ev.user).toBeUndefined();
    expect(ev.server_name).toBeUndefined();
    expect(ev.request).toEqual({ method: "POST", url: "https://x/api/claims" });
  });
});
