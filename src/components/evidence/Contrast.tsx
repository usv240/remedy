import { measured, payoutTiming } from "@/lib/payout-timing";
import { PORTAL_WAITS, RESEARCH, REFUND_TIMING } from "@/lib/research";

/**
 * The measured contrast the impact story leads with: how a claim portal states its refund timing on its own page
 * (src/lib/research.ts, RESEARCH.portal) against Remedy's PayPal payout, measured in the sandbox
 * (content/public/measured.json). The README and docs/research.md print the same two figures; tests/facts.test.ts
 * holds them to these sources.
 */
export function speedContrast() {
  const m = measured();
  const t = payoutTiming();
  const refund = m.items.find((i) => i.id === "refund");
  return {
    portal: RESEARCH.portal,
    /** "16 to 19 seconds", with its run count. */
    payout: t ? { figure: t.seconds, what: t.what, source: t.source, runs: String(t.runs) } : null,
    refundAtOnce: refund?.figure === "At once",
    measuredAt: m.measuredAt,
    environment: m.environment,
  };
}

/**
 * A small table of how long a photo-refund takes today, as each page already read states it (PORTAL_WAITS in
 * src/lib/research.ts, each with its source and date), then Remedy's payout as measured, labelled as the sandbox.
 */
export function Contrast({ className = "vs" }: { className?: string }) {
  const c = speedContrast();
  if (!c.payout) return null;
  return (
    <table className={`${className} vs-table`}>
      <caption className="vs-cap">How long a photo refund takes: as each page states it, and Remedy as measured in the {c.environment}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Wait</th>
          <th scope="col">What the page says, whose page, and when</th>
        </tr>
      </thead>
      <tbody>
        {PORTAL_WAITS.map((w) => (
          <tr key={w.id} className="vs-row">
            <th scope="row" className="vs-fig tabular">
              {w.wait}
            </th>
            <td className="vs-what">
              {w.says}{" "}
              <a className="text-link" href={w.url} target="_blank" rel="noreferrer">
                {w.who}
              </a>
              , {w.date}.
            </td>
          </tr>
        ))}
        <tr className="vs-row" data-rm="">
          <th scope="row" className="vs-fig tabular">
            {c.payout.figure}
          </th>
          <td className="vs-what">
            {`Remedy, in the ${c.environment}: from approval to a PayPal payout reaching the owner${c.payout.runs ? `, ${c.payout.runs} runs` : ""}.${c.refundAtOnce ? ` ${REFUND_TIMING.marked}; ${REFUND_TIMING.reach}.` : ""}`}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
