import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPool, POOL_ANSWER_FIELDS, type PoolRow } from "@/app/api/v1/hash-pool/_lib/pool";
import { POST as check } from "@/app/api/v1/hash-pool/check/route";
import { POST as register } from "@/app/api/v1/hash-pool/register/route";
import { ENDPOINTS, ERRORS } from "@/lib/api/endpoints";
import { firmOfScopes, POOL_WRITE_SCOPE } from "@/lib/api/keys";
import { openapi } from "@/lib/api/openapi";
import { HashPoolCheckRequest, HashPoolRegisterRequest } from "@/lib/api/v1-schemas";
import { photoHashes } from "@/lib/verify";
import { CATALOG_MAX_DISTANCE, DUPLICATE_MAX_DISTANCE, hamming } from "@/lib/verify/dhash";
import { FIXTURES_DIR } from "@/lib/verify/fixtures";

/**
 * The shared hash pool as another firm joins it: POST /api/v1/hash-pool/check and /register. The matching is the
 * pure function checkPool, so these tests run with no database; the routes are called as handlers with
 * DATABASE_URL unset, which is the demo tier with an empty pool.
 */

const fixture = (rel: string) => readFileSync(path.join(FIXTURES_DIR, rel));
/** Flip the lowest `bits` bits of a hash, so the distance is known exactly. */
function flip(h: string, bits: number): string {
  const lo = (parseInt(h.slice(8), 16) ^ ((1 << bits) - 1)) >>> 0;
  return h.slice(0, 8) + lo.toString(16).padStart(8, "0");
}
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as { data: Record<string, unknown> | null; error: { code: string; message: string } | null } });
const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://remedy.test${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

/**
 * No database in these tests. The guard (rate limits and the usage row) is covered by tests/ratelimit.test.ts and
 * public-api.test.ts; here it hands straight to the handler so the 401 can be seen with a database "configured" but
 * never opened. `configured` is what dbConfigured() answers inside the routes.
 */
let configured = false;
/** The two kinds of key, as keyFirm reads them from api_key: a self-serve sandbox key, and a key tied to firm 1. */
const KEYS: Record<string, { keyId: number; firmId: number | null }> = { "Bearer rm_test_selfserve": { keyId: 1, firmId: null } };
vi.mock("@/lib/api/keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/keys")>()),
  guard: (_req: Request, _endpoint: string, handler: () => Promise<Response>) => handler(),
  keyFirm: async (req: Request) => KEYS[req.headers.get("authorization") ?? ""] ?? null,
}));
vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), dbConfigured: () => configured }));

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.DATABASE_URL;
  configured = false;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("the request bodies", () => {
  it("take a 16-character lowercase hex hash and nothing looser", () => {
    expect(HashPoolCheckRequest.safeParse({ dhash: "337bfb9f4e7f3e0f" }).success).toBe(true);
    expect(HashPoolCheckRequest.safeParse({ dhash: "337bfb9f4e7f3e0f", recall_number: "FW-2026-01" }).success).toBe(true);
    expect(HashPoolCheckRequest.safeParse({ dhash: "337BFB9F4E7F3E0F" }).success).toBe(false);
    expect(HashPoolCheckRequest.safeParse({ dhash: "337bfb9f4e7f3e0" }).success).toBe(false);
    expect(HashPoolCheckRequest.safeParse({}).success).toBe(false);
    expect(HashPoolRegisterRequest.safeParse({ dhash: "337bfb9f4e7f3e0f", recall_number: "BH-2026-01" }).success).toBe(true);
    expect(HashPoolRegisterRequest.safeParse({ dhash: "337bfb9f4e7f3e0f", recall_number: "BH-2026-01", ref: "partner-demo-1" }).success).toBe(true);
    expect(HashPoolRegisterRequest.safeParse({ dhash: "337bfb9f4e7f3e0f" }).success).toBe(false);
    expect(HashPoolRegisterRequest.safeParse({ dhash: "337bfb9f4e7f3e0f", recall_number: "BH-2026-01", ref: "has space" }).success).toBe(false);
    expect(HashPoolRegisterRequest.safeParse({ dhash: "337bfb9f4e7f3e0f", recall_number: "BH-2026-01", ref: "x".repeat(65) }).success).toBe(false);
  });
});

describe("checkPool", () => {
  it("finds the sample charger's hash registered at another firm, within 4 bits, and returns only the ref", async () => {
    const { dhash } = await photoHashes(fixture("sample/cord-cut.jpg"));
    const pool: PoolRow[] = [{ ref: "partner-demo-1", dhash, source: "partner", recallNumber: "BH-2026-01" }];
    const r = checkPool(dhash, "FW-2026-01", pool);
    expect(r).toMatchObject({ hit: true, distance: 0, threshold_bits: CATALOG_MAX_DISTANCE, ref: "partner-demo-1", source: "partner" });
    expect(r.pool).toMatchObject({ claim_rows: 0, partner_rows: 1 });
    expect(r.pool.published_pictures).toBeGreaterThan(1000);
    expect(JSON.stringify(r)).not.toContain("BH-2026-01");
    expect(Object.keys(r).sort()).toEqual([...POOL_ANSWER_FIELDS].sort());
  });

  it("applies 4 bits to another recall's rows and 10 to the claimed recall's own", async () => {
    const { dhash } = await photoHashes(fixture("sample/cord-cut.jpg"));
    const sixOff = flip(dhash, 6);
    expect(hamming(dhash, sixOff)).toBe(6);
    const elsewhere: PoolRow[] = [{ ref: "row-a", dhash: sixOff, source: "claim", recallNumber: "BH-2026-01" }];
    expect(checkPool(dhash, "FW-2026-01", elsewhere).hit).toBe(false);
    expect(checkPool(dhash, null, elsewhere).hit).toBe(false);
    const own: PoolRow[] = [{ ref: "row-b", dhash: sixOff, source: "claim", recallNumber: "FW-2026-01" }];
    expect(checkPool(dhash, "FW-2026-01", own)).toMatchObject({ hit: true, distance: 6, threshold_bits: DUPLICATE_MAX_DISTANCE, ref: "row-b", source: "claim" });
    const three: PoolRow[] = [{ ref: "row-c", dhash: flip(dhash, 3), source: "claim", recallNumber: "BH-2026-01" }];
    expect(checkPool(dhash, "FW-2026-01", three)).toMatchObject({ hit: true, distance: 3, threshold_bits: CATALOG_MAX_DISTANCE, ref: "row-c" });
  });

  it("prefers the closest row when several are within range", async () => {
    const { dhash } = await photoHashes(fixture("sample/cord-cut.jpg"));
    const pool: PoolRow[] = [
      { ref: "far", dhash: flip(dhash, 4), source: "partner", recallNumber: "X-1" },
      { ref: "near", dhash: flip(dhash, 1), source: "claim", recallNumber: "X-2" },
    ];
    expect(checkPool(dhash, null, pool)).toMatchObject({ hit: true, distance: 1, ref: "near", source: "claim" });
  });

  it("reports no hit for a photo of a mug, against the pool and the published pictures of every recall", async () => {
    const { dhash: charger } = await photoHashes(fixture("sample/cord-cut.jpg"));
    const { dhash: mug } = await photoHashes(fixture("other/commons-coffee-in-a-mug.jpg"));
    const pool: PoolRow[] = [{ ref: "partner-demo-1", dhash: charger, source: "partner", recallNumber: "BH-2026-01" }];
    const r = checkPool(mug, "FW-2026-01", pool);
    expect(r).toMatchObject({ hit: false, distance: null, threshold_bits: null, ref: null, source: null });
  });

  it("finds a published recall picture at its own recall (10 bits) and at another recall (4 bits)", async () => {
    const { dhash } = await photoHashes(fixture("official/27056-haiara-1.jpg"));
    const own = checkPool(dhash, "27056", []);
    expect(own).toMatchObject({ hit: true, source: "official", threshold_bits: DUPLICATE_MAX_DISTANCE });
    expect(own.distance).toBeLessThanOrEqual(2);
    const other = checkPool(dhash, "26754", []);
    expect(other).toMatchObject({ hit: true, source: "official", threshold_bits: CATALOG_MAX_DISTANCE });
    expect(other.ref).toMatch(/^https?:\/\//);
  });

  it("never matches a flat hash", () => {
    const pool: PoolRow[] = [{ ref: "flat", dhash: "0000000000000001", source: "claim", recallNumber: "X" }];
    expect(checkPool("0000000000000001", null, pool).hit).toBe(false);
  });
});

describe("POST /api/v1/hash-pool/check (no database: an empty pool, the published pictures still checked)", () => {
  it("answers in the envelope with only the pool fields", async () => {
    const { dhash } = await photoHashes(fixture("sample/cord-cut.jpg"));
    const { status, body } = await json(await check(post("/api/v1/hash-pool/check", { dhash, recall_number: "FW-2026-01" })));
    expect(status).toBe(200);
    expect(body.error).toBeNull();
    expect(Object.keys(body.data!).sort()).toEqual([...POOL_ANSWER_FIELDS].sort());
    expect(body.data).toMatchObject({ hit: false, pool: { claim_rows: 0, partner_rows: 0 } });
  });

  it("rejects a bad hash with a plain message and the field named", async () => {
    const { status, body } = await json(await check(post("/api/v1/hash-pool/check", { dhash: "not-a-hash" })));
    expect(status).toBe(422);
    expect(body.error?.code).toBe("invalid_request");
    expect(body.error?.message).toMatch(/16 lowercase hex/);
    const bad = await json(await check(post("/api/v1/hash-pool/check", "{not json")));
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/v1/hash-pool/register", () => {
  it("says the pool is not connected without a database (503), before it asks for a key", async () => {
    const { status, body } = await json(await register(post("/api/v1/hash-pool/register", { dhash: "337bfb9f4e7f3e0f", recall_number: "BH-2026-01" })));
    expect(status).toBe(503);
    expect(body.error?.code).toBe("upstream_unavailable");
  });

  it("needs a key when a database is configured (401 with none)", async () => {
    // keyIdFor answers null before any query when there is no token, so no connection is opened.
    configured = true;
    const { status, body } = await json(await register(post("/api/v1/hash-pool/register", { dhash: "337bfb9f4e7f3e0f", recall_number: "BH-2026-01", ref: "partner-demo-1" })));
    expect(status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
  });

  it("refuses a self-serve sandbox key with a plain 403: only a key tied to a connected firm may write to the pool", async () => {
    configured = true;
    const { status, body } = await json(await register(post("/api/v1/hash-pool/register", { dhash: "337bfb9f4e7f3e0f", recall_number: "BH-2026-01" }, { Authorization: "Bearer rm_test_selfserve" })));
    expect(status).toBe(403);
    expect(body.error?.code).toBe("forbidden");
    expect(body.error?.message).toMatch(/can check hashes but not register them/);
    expect(body.error?.message).toMatch(/firms connected to Remedy/);
    // Checking stays open: the same caller, and a caller with no key at all, get an answer (here with no database: the published pictures alone).
    configured = false;
    for (const headers of [{ Authorization: "Bearer rm_test_selfserve" }, {}] as Record<string, string>[]) expect((await check(post("/api/v1/hash-pool/check", { dhash: "337bfb9f4e7f3e0f" }, headers))).status).toBe(200);
  });

  it("reads the firm a key is tied to from its scopes, and only with the register scope", () => {
    expect(firmOfScopes(["read", "verify", POOL_WRITE_SCOPE, "firm:7"])).toBe(7);
    expect(firmOfScopes(["read", "verify", "payments:sandbox"])).toBeNull();
    // A firm scope without the register scope, or the register scope without a firm, writes nothing.
    expect(firmOfScopes(["read", "firm:7"])).toBeNull();
    expect(firmOfScopes([POOL_WRITE_SCOPE])).toBeNull();
    expect(firmOfScopes([POOL_WRITE_SCOPE, "firm:0", "firm:x"])).toBeNull();
    expect(firmOfScopes(null)).toBeNull();
    expect(ERRORS.map((e) => e.code)).toContain("forbidden");
  });

  it("validates the body first", async () => {
    const { status } = await json(await register(post("/api/v1/hash-pool/register", { dhash: "337bfb9f4e7f3e0f" })));
    expect(status).toBe(422);
  });
});

describe("the hash pool in the API description", () => {
  it("is in ENDPOINTS, so the docs page and llms.txt list it, and in OpenAPI with its request bodies", () => {
    const ids = ENDPOINTS.map((e) => e.id);
    expect(ids).toContain("hash-pool-check");
    expect(ids).toContain("hash-pool-register");
    const reg = ENDPOINTS.find((e) => e.id === "hash-pool-register")!;
    expect(reg.keyed).toBe(true);
    expect(reg.scope).toBe(POOL_WRITE_SCOPE);
    expect(reg.note).toMatch(/firm key/);
    const spec = openapi("https://remedy.example") as { paths: Record<string, Record<string, { tags: string[]; requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown>; required?: string[] } }> } }>>; tags: { name: string }[] };
    const c = spec.paths["/api/v1/hash-pool/check"].post;
    const r = spec.paths["/api/v1/hash-pool/register"].post;
    expect(Object.keys(c.requestBody!.content["application/json"].schema.properties!)).toEqual(["dhash", "phash", "recall_number"]);
    expect(c.requestBody!.content["application/json"].schema.required).toEqual(["dhash"]);
    expect(Object.keys(r.requestBody!.content["application/json"].schema.properties!)).toEqual(["dhash", "phash", "recall_number", "ref"]);
    expect(r.requestBody!.content["application/json"].schema.required).toEqual(["dhash", "recall_number"]);
    expect(c.tags).toEqual(["Hash pool"]);
    expect(spec.tags.map((t) => t.name)).toContain("Hash pool");
  });
});
