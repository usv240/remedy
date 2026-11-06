import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { OpenAll } from "@/components/developers/OpenAll";
import { Toc } from "@/components/learn/Toc";
import examples from "../../../../content/public/api-examples.json";
import { ENDPOINTS, ERRORS, type Endpoint, type Field } from "@/lib/api/endpoints";
import { KEY_PREFIX, LIMITS } from "@/lib/api/keys";
import { openapi } from "@/lib/api/openapi";
import { VERIFY_LIMITS } from "@/lib/api/v1-schemas";
import { TOOLS } from "@/lib/mcp/tools";
import { HOSTED_URL } from "@/lib/origin";

/** One recorded response per endpoint, from content/public/api-examples.json. */
const EXAMPLES = (examples as { recordedAt: string; examples: Record<string, { request: string; status: number; ms: number; response: unknown }> }).examples;

function FieldTable({ rows, label }: { rows: Field[]; label: string }) {
  return (
    <div className="doc-table-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="doc-table doc-fields">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">About</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="doc-name">
                <code>{r.name}</code>
                {r.required && <span className="doc-req"> required</span>}
              </td>
              <td className="doc-type">
                <code>{r.type}</code>
              </td>
              <td>{r.about}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
import "../../pages.css";
import "../../learn/toc.css";
import "../../learn/disclosure.css";
import "../dev.css";

export const metadata: Metadata = { title: "API docs", description: "Every Remedy endpoint, its fields, errors and limits." };

const HOST = (process.env.RENDER_EXTERNAL_URL || HOSTED_URL).replace(/\/$/, "");

type JsonSchema = { type?: string | string[]; description?: string; enum?: unknown[]; default?: unknown; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; anyOf?: JsonSchema[] };

function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
  if (s.type === "array") return `array of ${s.items ? typeOf(s.items) : "items"}`;
  return Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "any");
}

/** Flatten a request schema into rows: photo, recall_number, payee.type, and so on. */
function fields(s: JsonSchema, prefix = ""): { name: string; type: string; required: boolean; about: string }[] {
  const out: { name: string; type: string; required: boolean; about: string }[] = [];
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    const name = prefix ? `${prefix}.${k}` : k;
    const nested = v.type === "object" ? v : v.type === "array" && v.items?.type === "object" ? v.items : null;
    out.push({
      name: nested && v.type === "array" ? `${name}[]` : name,
      type: nested ? (v.type === "array" ? "array of objects" : "object") : typeOf(v),
      required: Boolean(s.required?.includes(k)),
      about: [v.description, v.default !== undefined ? `Default ${JSON.stringify(v.default)}.` : ""].filter(Boolean).join(" "),
    });
    if (nested) out.push(...fields(nested, nested === v ? name : `${name}[]`));
  }
  return out;
}

/** The example request for an endpoint, in cURL, built from the same data the playground uses. */
function curlFor(e: Endpoint) {
  const q = (e.query ?? []).filter((p) => p.example).map((p) => `${p.name}=${encodeURIComponent(p.example ?? "")}`);
  const url = `${HOST}${e.samplePath ?? e.path}${q.length ? `?${q.join("&")}` : ""}`;
  const parts = [`curl${e.method === "POST" ? " -X POST" : ""} "${url}"`];
  if (e.keyed) parts.push(`  -H "Authorization: Bearer ${KEY_PREFIX}…"`);
  if (e.upload) {
    parts.push(`  -F "photo=@photo.jpg"`);
    for (const [k, v] of Object.entries((e.example ?? {}) as Record<string, unknown>)) parts.push(`  -F "${k}=${String(v)}"`);
  } else if (e.method === "POST" && e.example !== undefined) {
    parts.push(`  -H "Content-Type: application/json"`, `  -d '${JSON.stringify(e.example)}'`);
  }
  return parts.join(" \\\n");
}

export default function DocsPage() {
  const spec = openapi("");
  const contents = [{ id: "keys", title: "Keys and limits" }, ...ENDPOINTS.map((e) => ({ id: e.id, title: e.title })), { id: "mcp", title: "MCP server" }, { id: "errors", title: "Errors" }];
  return (
    <div className="page frame dev-docs">
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">API docs</h1>
          <Info id="page.docs" />
        </div>
        <p className="lede">
          Every endpoint, its fields, errors and limits. The same description is at{" "}
          <a className="text-link" href="/openapi.json">
            /openapi.json
          </a>{" "}
          for API clients, SDK generators and AI agents.
        </p>
      </header>

      <div className="doc-body">
        <Toc className="doc-toc" items={contents} />

        <div className="doc-main">
          <section id="keys" className="page-section doc-sec" aria-labelledby="auth-h">
            <h2 id="auth-h">Keys and limits</h2>
            <div className="page-prose">
              <p>
                Send your key as <code>Authorization: Bearer {KEY_PREFIX}…</code>. With a key: {LIMITS.keyPerMinute} requests a minute and {LIMITS.keyPerDay.toLocaleString("en-US")} a day, and every call shows on your usage page. Without one: {LIMITS.demoPerMinute} a minute.
              </p>
              <p>
                Every response has the same shape: <code>{"{ data, meta, error }"}</code>. <code>meta</code> carries <code>request_id</code>, <code>version</code> and <code>latency_ms</code>. Rate-limit headers: <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, and <code>Retry-After</code> on a 429.
              </p>
              <p>
                <Link className="text-link" href="/developers#key-h">
                  Get a free key
                </Link>
              </p>
            </div>
          </section>

          <section className="page-section doc-eps" aria-labelledby="endpoints-h">
            <div className="doc-eps-head">
              <h2 id="endpoints-h">Endpoints</h2>
              <OpenAll selector=".doc-ep" controls={ENDPOINTS.map((e) => e.id).join(" ")} />
            </div>
            <p className="page-prose">
              {ENDPOINTS.length} endpoints. Each one opens to its fields and an example request.
            </p>
            <div className="doc-ep-list">
              {ENDPOINTS.map((e) => {
                const op = (spec.paths[e.path] as Record<string, { requestBody?: { content?: Record<string, { schema?: JsonSchema }> } }>)[e.method.toLowerCase()];
                const schema = op?.requestBody?.content?.["application/json"]?.schema;
                const rows = e.formFields ? e.formFields : schema ? fields(schema) : [];
                const params: Field[] = [...(e.params ?? []).map((p) => ({ name: p.name, type: "path", about: p.description, required: true })), ...(e.query ?? []).map((q) => ({ name: q.name, type: q.enum ? q.enum.map((v) => JSON.stringify(v)).join(" | ") : "query", about: q.description }))];
                const ex = EXAMPLES[e.id];
                return (
                  <details key={e.id} id={e.id} className="dsc doc-ep doc-sec">
                    <summary>
                      <h3 id={`${e.id}-h`} className="dsc-k">
                        {e.title}
                      </h3>
                      <span className="dev-route tabular">
                        <code>
                          <span className="dev-method">{e.method}</span> {e.path}
                        </code>
                        {e.ai && <span className="dev-tag">Claude</span>}
                      </span>
                      <span className="doc-ep-line">{e.summary}</span>
                    </summary>
                    <div className="doc-ep-body">
                      {e.note && <p>{e.note}</p>}
                      {params.length > 0 && <FieldTable rows={params} label={`${e.title} parameters`} />}
                      {rows.length > 0 && <FieldTable rows={rows} label={`${e.title} ${e.upload ? "form fields" : "body fields"}`} />}
                      <figure className="doc-example">
                        <figcaption className="doc-cap">Example request</figcaption>
                        <pre className="dev-pre tabular" tabIndex={0} aria-label={`${e.title}: example request`}>
                          {curlFor(e)}
                        </pre>
                      </figure>
                      {e.responseFields && <FieldTable rows={e.responseFields} label={`${e.title} response fields`} />}
                      {ex && (
                        <figure className="doc-example">
                          <figcaption className="doc-cap">
                            Recorded response, {ex.status} in {ex.ms} ms: <code>{ex.request}</code>
                          </figcaption>
                          <pre className="dev-pre tabular doc-resp" tabIndex={0} aria-label={`${e.title}: recorded response`}>
                            {JSON.stringify(ex.response, null, 2)}
                          </pre>
                        </figure>
                      )}
                      {e.id !== "health" && e.playground !== false && (
                        <p>
                          <Link className="text-link" href={`/developers?endpoint=${e.id}#playground`}>
                            Try it in the playground
                          </Link>
                        </p>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section id="mcp" className="page-section doc-sec" aria-labelledby="mcp-h">
            <div className="title-row">
              <h2 id="mcp-h">MCP server</h2>
              <Info id="dev.mcp" label="" />
            </div>
            <div className="page-prose">
              <p>
                The same search, proof rules and photo checks, as tools for AI assistants, over the Model Context Protocol (streamable HTTP, JSON answers). Add it to Claude Code with:
              </p>
            </div>
            <pre className="dev-pre tabular" tabIndex={0} aria-label="Add the MCP server">
              {`claude mcp add --transport http remedy ${HOST}/api/mcp`}
            </pre>
            <details className="dsc doc-more">
              <summary>
                <span className="dsc-k">The {TOOLS.length} tools, with what each one does</span>
              </summary>
            <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="MCP tools">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th scope="col">Tool</th>
                    <th scope="col">What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {TOOLS.map((t) => (
                    <tr key={t.name}>
                      <td className="doc-name">
                        <code>{t.name}</code>
                      </td>
                      <td>
                        {t.description}
                        {t.changes && <span className="muted"> Changes: {t.changes}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </details>
            <p className="page-prose">
              Send your key as <code>Authorization: Bearer {KEY_PREFIX}…</code> for the full photo checks (up to {VERIFY_LIMITS.visionPerKeyPerDay} a day per key); without one, verify_photo runs the free checks only. Discovery:{" "}
              <a className="text-link" href="/api/mcp/server-card">
                server card
              </a>
              ,{" "}
              <a className="text-link" href="/.well-known/ai-catalog.json">
                AI catalog
              </a>{" "}
              and{" "}
              <a className="text-link" href="/llms.txt">
                llms.txt
              </a>
              .
            </p>
          </section>

          <section id="errors" className="page-section doc-sec" aria-labelledby="errors-h">
            <h2 id="errors-h">Errors</h2>
            <p className="page-prose">Every error has a code you can branch on and a plain message you can show to people.</p>
            <details className="dsc doc-more">
              <summary>
                <span className="dsc-k">All {ERRORS.length} error codes, with their HTTP status</span>
              </summary>
            <dl className="doc-errors">
              {ERRORS.map((x) => (
                <div key={x.code} id={`errors-${x.code}`} className="doc-error">
                  <dt>
                    <code>{x.code}</code> <span className="muted tabular">{x.status}</span>
                  </dt>
                  <dd>{x.plain}</dd>
                </div>
              ))}
            </dl>
            </details>
          </section>
        </div>
      </div>
      <OpenOnHash />
    </div>
  );
}
