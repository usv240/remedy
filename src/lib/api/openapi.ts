import { z } from "zod";
import { ENDPOINTS, ERRORS } from "./endpoints";
import { API_VERSION } from "./envelope";
import { KeyRequest } from "./schemas";
import { ProofRuleRequest } from "./v1-schemas";

const json = (s: z.ZodType) => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io: "input" }) as Record<string, unknown>;
  void _drop;
  return rest;
};

/** JSON request bodies by endpoint id, from the same Zod schemas the routes validate with. */
const BODIES: Record<string, Record<string, unknown>> = { "proof-rule": json(ProofRuleRequest) };

/** OpenAPI 3.1, generated from the same Zod schemas the endpoints validate with. */
export function openapi(server: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const op: Record<string, unknown> = {
      operationId: e.id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()),
      summary: e.title,
      description: e.summary,
      tags: [e.keyed ? "Recalls and claims" : "Utilities"],
      security: e.keyed ? [{ apiKey: [] }, {}] : [],
      responses: {
        "200": { description: "Success. The answer is in data; meta has request_id, version and latency_ms.", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
        ...(e.keyed ? { "429": { $ref: "#/components/responses/RateLimited" } } : {}),
        default: { $ref: "#/components/responses/Error" },
      },
    };
    const params: Record<string, unknown>[] = [];
    for (const p of e.params ?? []) params.push({ name: p.name, in: "path", required: true, description: p.description, schema: { type: "string" } });
    for (const p of e.query ?? []) params.push({ name: p.name, in: "query", description: p.description, schema: { type: "string", ...(p.enum ? { enum: p.enum } : {}), ...(p.example ? { example: p.example } : {}) } });
    if (params.length) op.parameters = params;
    if (e.scope) op["x-remedy-scope"] = e.scope;
    if (e.note) op.description = `${e.summary} ${e.note}`;
    if (BODIES[e.id]) op.requestBody = { required: true, content: { "application/json": { schema: BODIES[e.id], example: e.example } } };
    else if (!e.upload && e.formFields) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: { type: "object", required: e.formFields.filter((f) => f.required).map((f) => f.name), properties: Object.fromEntries(e.formFields.map((f) => [f.name, { type: "string", description: f.about }])) }, example: e.example } },
      };
    }
    if (e.upload) {
      const fields = e.formFields ?? [{ name: "photo", type: "file", about: "JPEG, PNG or WebP, up to 10 MB.", required: true }];
      op.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: fields.filter((f) => f.required).map((f) => f.name),
              properties: Object.fromEntries(fields.map((f) => [f.name, f.type === "file" ? { type: "string", format: "binary", description: f.about } : { type: "string", description: f.about }])),
            },
          },
        },
      };
    }
    paths[e.path] = { ...(paths[e.path] ?? {}), [e.method.toLowerCase()]: op };
  }
  paths["/api/keys"] = {
    post: {
      operationId: "createKey",
      summary: "Create a sandbox API key",
      description: "Returns the full key once. Only its SHA-256 hash is stored. Limits: 5 new keys per client and 3 per email each day.",
      tags: ["Keys"],
      requestBody: { required: true, content: { "application/json": { schema: json(KeyRequest) } } },
      responses: { "200": { description: "The new key, shown once.", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } }, default: { $ref: "#/components/responses/Error" } },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Remedy API",
      version: API_VERSION,
      description: "Recall refunds on a verified photo: search CPSC recalls, read a remedy as a proof rule, verify an owner's photo and pay the refund through PayPal. Sandbox only: no real money and no real personal data.",
    },
    servers: [{ url: server }],
    tags: [
      { name: "Recalls and claims", description: "Recall search, proof rules, photo verification and claims. A key is optional for reads; with one you get higher limits and usage." },
      { name: "Utilities", description: "The ledger check and service status." },
      { name: "Keys", description: "Free sandbox keys." },
    ],
    paths,
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "An rm_test_ key from the Developers page." } },
      schemas: {
        Envelope: {
          type: "object",
          properties: {
            data: { description: "The answer. Null on error." },
            meta: { type: "object", properties: { request_id: { type: "string" }, version: { type: "string" }, latency_ms: { type: "integer" } } },
            error: { $ref: "#/components/schemas/Error" },
          },
        },
        Error: {
          type: ["object", "null"],
          properties: {
            code: { type: "string", enum: ERRORS.map((x) => x.code) },
            message: { type: "string", description: "A plain sentence you can show to people." },
            docs: { type: "string" },
            details: {},
          },
        },
      },
      responses: {
        Error: { description: "An error, with a plain message.", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
        RateLimited: {
          description: "Too many requests. Retry after the number of seconds in Retry-After.",
          headers: { "Retry-After": { schema: { type: "integer" } } },
          content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } },
        },
      },
    },
  };
}
