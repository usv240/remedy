import measured from "../../../content/public/measured.json";
import { RESEARCH, REFUND_TIMING } from "@/lib/research";

/**
 * The measured contrast the impact story leads with: how a claim portal states its refund timing on its own page
 * (src/lib/research.ts, RESEARCH.portal) against Remedy's PayPal payout, measured in the sandbox
 * (content/public/measured.json). The README and docs/research.md print the same two figures; tests/facts.test.ts
 * holds them to these sources.
 */
export function speedContrast() {
  const item = (id: string) => measured.items.find((i) => i.id === id);
  const payout = item("payout");
  const refund = item("refund");
  return {
    portal: RESEARCH.portal,
    /** "17 to 18 seconds", from "17 to 18 s". */
    payout: payout ? { figure: payout.figure.replace(/\bs$/, "seconds"), what: payout.what, source: payout.source, runs: /in (\d+) sandbox runs/.exec(payout.what)?.[1] ?? null } : null,
    refundAtOnce: refund?.figure === "At once",
    measuredAt: measured.measuredAt,
    environment: measured.environment,
  };
}

/** Two lines, the same shape: what a claim portal states today, and what Remedy measured. */
export function Contrast({ className = "vs" }: { className?: string }) {
  const c = speedContrast();
  if (!c.payout) return null;
  return (
    <dl className={className}>
      <div className="vs-row">
        <dt className="vs-fig tabular">{c.portal.days}</dt>
        <dd className="vs-what">
          A claim portal&rsquo;s refund today: {c.portal.how}, as{" "}
          <a className="text-link" href={c.portal.url} target="_blank" rel="noreferrer">
            {c.portal.short}
          </a>{" "}
          states it.
        </dd>
      </div>
      <div className="vs-row" data-rm="">
        <dt className="vs-fig tabular">{c.payout.figure}</dt>
        <dd className="vs-what">
          {`Remedy’s refund: from approval to a PayPal payout reaching the owner, measured in the ${c.environment}${c.payout.runs ? ` (${c.payout.runs} runs)` : ""}.${c.refundAtOnce ? ` ${REFUND_TIMING.marked}; ${REFUND_TIMING.reach}.` : ""}`}
        </dd>
      </div>
    </dl>
  );
}
