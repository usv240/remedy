import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { Info } from "@/components/Info";

type Step = { why: string; tool: string; arguments: Record<string, unknown>; text: string; isError: boolean; ms: number };
type Session = { note: string; recordedAt: string; server: { name?: string; version?: string; protocolVersion?: string }; tools: string[]; owner: string; steps: Step[] };

export const MCP_SESSION_FILE = "content/public/mcp-session.json";

/** content/public/mcp-session.json, written by scripts/public/record-mcp-session.mjs, or null when it is not there. */
export function session(): Session | null {
  const file = path.join(process.cwd(), "content", "public", "mcp-session.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Session;
  } catch {
    return null;
  }
}

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * An AI assistant using Remedy's tools: a recorded session of real MCP tool calls against this server's /api/mcp,
 * from finding the recall to a claim ready to pay. Only the tool calls and the server's answers are shown; no model
 * was called to record them. {origin} in the record is this server's own address.
 */
export function McpSession({ host }: { host: string }) {
  const s = session();
  if (!s?.steps.length) return null;
  return (
    <section className="page-section mcp" aria-labelledby="mcp-h">
      <div className="title-row">
        <h2 id="mcp-h">An AI assistant, using Remedy&rsquo;s tools</h2>
        <Info id="dev.mcp-session" label="" topic="the recorded session" />
      </div>
      <SessionBody s={s} host={host} />
      <p className="page-note">
        Server {s.server.name} {s.server.version}, MCP protocol {s.server.protocolVersion}, with {s.tools.length} tools: {s.tools.join(", ")}. Add it to your own assistant with the command in the{" "}
        <Link className="text-link" href="/developers/docs#mcp">
          docs
        </Link>
        . Demonstration in PayPal sandbox; Brightline Home and its recall are fictional.
      </p>
    </section>
  );
}

/**
 * The same recorded run on /try, folded under one heading: "An assistant does it", from the owner's question to "Ready
 * to pay", with the file it is read from. The page's own note carries the sandbox caveat.
 */
export function AssistantRun() {
  const s = session();
  if (!s?.steps.length) return null;
  return (
    <section className="page-section mcp tr-assistant" aria-labelledby="assist-h">
      <details className="dsc">
        <summary>
          <h2 id="assist-h" className="dsc-k tr-assistant-h">
            An assistant does it
          </h2>
        </summary>
        <SessionBody s={s} host="" />
        <p className="page-note">
          Read from <code>{MCP_SESSION_FILE}</code>, written by <code>scripts/public/record-mcp-session.mjs</code>. Every tool, with the command to add them to your own assistant:{" "}
          <Link className="text-link" href="/developers">
            For developers
          </Link>
          .
        </p>
      </details>
    </section>
  );
}

function SessionBody({ s, host }: { s: Session; host: string }) {
  const at = (v: string) => v.split("{origin}").join(host);
  const fmtArgs = (a: Record<string, unknown>) => at(JSON.stringify(a, null, 2));
  return (
    <>
      <p className="page-prose">
        The tool calls an assistant makes to help an owner, from the recall to a claim ready to pay: {words[s.steps.length] ?? s.steps.length} calls to this server&rsquo;s MCP endpoint, recorded on {day(s.recordedAt)}. Only the
        calls and the server&rsquo;s answers are shown. No AI model was called to record them: the photo&rsquo;s verdict is replayed from the verification cache, and the owner chooses where the refund goes.
      </p>
      <p className="mcp-ask">
        <span className="mcp-k">The owner asks</span> &ldquo;{s.owner}&rdquo;
      </p>
      <ol className="mcp-steps">
        {s.steps.map((st, i) => (
          <li key={`${st.tool}-${i}`} className="mcp-step" data-ui>
            <p className="mcp-why">{st.why}</p>
            <div className="mcp-call">
              <p className="mcp-head">
                <code className="mcp-tool">{st.tool}</code>
                <span className="mcp-ms tabular">{st.ms} ms</span>
              </p>
              <pre className="dev-pre mcp-pre" tabIndex={0} aria-label={`${st.tool} arguments`}>
                {fmtArgs(st.arguments)}
              </pre>
              <pre className="dev-pre mcp-pre mcp-out" tabIndex={0} aria-label={`${st.tool} answer`} data-error={st.isError ? "" : undefined}>
                {at(st.text)}
              </pre>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
