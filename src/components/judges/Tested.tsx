import facts from "../../../content/public/facts.json";

type Facts = {
  unitTests: { passed: number; skipped: number; ranAt: string };
  a11y: { pages: number; views: number; passed: number; ranAt: string } | null;
  mcp: { tools: number; names: string[] };
};

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

/**
 * How Remedy is tested, from content/public/facts.json: written by scripts/facts.ts after the suites run, the same file
 * the README and TESTING.md are checked against (tests/facts.test.ts).
 */
export function Tested() {
  const f = facts as unknown as Facts;
  return (
    <>
      <ul className="jm">
        <li>
          <p className="jm-fig tabular">{f.unitTests.passed.toLocaleString("en-US")}</p>
          <p className="jm-what">unit tests pass with no keys and no database, as CI runs them: the proof rules, the six checks and the decision, perceptual hashing, payments and webhooks, the firm console, the API and MCP.</p>
          <p className="jm-src">
            npm test, {day(f.unitTests.ranAt)}. {f.unitTests.skipped} more run where the Claude, PayPal or Postgres keys are set.
          </p>
        </li>
        {f.a11y && (
          <li>
            <p className="jm-fig tabular">{f.a11y.passed}</p>
            <p className="jm-what">
              of {f.a11y.views} page views pass axe (WCAG 2.2 AA, serious and critical) with no sideways scroll: {f.a11y.pages} pages, each at phone and desktop width, light and dark.
            </p>
            <p className="jm-src">npm run e2e:a11y, {day(f.a11y.ranAt)}</p>
          </li>
        )}
        <li>
          <p className="jm-fig tabular">{f.mcp.tools}</p>
          <p className="jm-what">tools on the MCP server, each answered by the same code as the API: {f.mcp.names.join(", ")}.</p>
          <p className="jm-src">src/lib/mcp/tools.ts, checked by node tests/e2e/public.mjs</p>
        </li>
      </ul>
      <p className="page-note">Every figure in this list is read from content/public/facts.json, written by scripts/facts.ts after the suites run. A unit test fails when the README or TESTING.md print a different one.</p>
    </>
  );
}
