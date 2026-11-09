import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CHECK_ORDER, checkWord, money, when } from "@/components/claim/format";
import { SAMPLE_RECALL } from "@/lib/firm/firm";
import { sampleChecks, sampleRunFor } from "@/lib/firm/sample-claims";
import { SANDBOX_LABEL } from "@/lib/payments/deps";
import { payerWords, SAMPLE_PHOTO_CREDIT } from "@/lib/recall/label";
import { recordedReceipt } from "@/lib/recorded-receipt";
import "../../pages.css";
import "@/components/claim/claim.css";

export const metadata: Metadata = {
  title: "A recorded sandbox payout receipt",
  description: "A real PayPal sandbox payout's receipt, recorded from the one-click payout on /try, with PayPal's batch id and status.",
  robots: { index: false },
};

/**
 * A recorded receipt at a fixed address: the one-click sandbox payout's last run (content/public/e2e-transcript.json,
 * src/lib/recorded-receipt.ts), so anyone can see what a paid receipt holds without sending a payout. Read from the
 * repo, not the database: the same on every deployment, and no reseed removes it. The six checks are the recorded run
 * the payout's claim carried (src/lib/firm/samples/claim-runs.json).
 */
export default function RecordedReceiptPage() {
  const r = recordedReceipt();
  if (!r) notFound();
  const checks = sampleChecks("paid", 0);
  // The recorded run this claim carried: an unsure product match that the two reviewers settled, as on every receipt.
  const reviewersAgreed = sampleRunFor("paid", 0).decidedBy === "reviewers";
  const amount = money(r.amount);
  return (
    <div className="rc-page frame">
      <header className="rc-head" data-paid="">
        <p className="rc-pill">
          <span className="pill" data-tone="info">
            Recorded
          </span>
        </p>
        <h1 className="rc-title">Paid {amount} to the sandbox buyer&rsquo;s PayPal.</h1>
        <p className="rc-sub">
          A real PayPal sandbox payout, recorded on {when(r.ranAt)} from the one-click payout on{" "}
          <Link className="text-link" href="/try">
            /try
          </Link>
          {r.seconds !== null ? `; PayPal reported it paid ${r.seconds} s after approval` : ""}. Nothing is sent when this page opens.
        </p>
        <p className="rc-id tabular">
          Sandbox payout ID {r.itemId}, batch {r.batchId}, PayPal status {r.status}
        </p>
      </header>

      <div className="rc-body">
        <section className="rc-card app-sheet" aria-labelledby="rc-what" data-ui>
          <h2 id="rc-what" className="rc-h">
            The claim
          </h2>
          <dl className="rc-facts">
            <div>
              <dt>Product</dt>
              <dd>Brightline 65W laptop charger (sample)</dd>
            </div>
            <div>
              <dt>Recall</dt>
              <dd>
                <Link className="text-link tabular" href={`/claim/${SAMPLE_RECALL}`}>
                  {SAMPLE_RECALL}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Refund</dt>
              <dd className="tabular">{amount}</dd>
            </div>
            <div>
              <dt>Sent to</dt>
              <dd>The PayPal sandbox buyer account</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd className="tabular">{when(r.ranAt)}</dd>
            </div>
            <div>
              <dt>Paid by</dt>
              <dd>{payerWords(SAMPLE_RECALL).short}</dd>
            </div>
          </dl>
          <p className="rc-why">Every check passed, so plain code sent the refund as a PayPal payout to the sandbox buyer, through the same router and payouts code every claim uses.</p>
        </section>

        <section className="rc-card app-sheet" aria-labelledby="rc-checks" data-ui>
          <h2 id="rc-checks" className="rc-h">
            The six checks
          </h2>
          <div className="rc-checks-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element -- the sample photo served from /public */}
            <img className="rc-photo" src="/samples/charger/cord-cut.jpg" alt="The sample charger with its cord cut" width={160} height={160} />
            <ul className="rc-checks">
              {CHECK_ORDER.map(({ id, name }) => {
                const k = checks[id];
                const w = checkWord(k?.status ?? "skipped", { reviewersAgreed });
                return (
                  <li key={id}>
                    <span>{name}</span>
                    <span className="cl-check-word" data-tone={w.tone}>
                      {w.word}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="cl-hint">{SAMPLE_PHOTO_CREDIT}. Sample recall; Brightline Home and its recall are fictional.</p>
        </section>

        <section className="rc-card app-sheet cl-tech" aria-labelledby="rc-tech" data-ui>
          <h2 id="rc-tech" className="rc-h">
            Technical record
          </h2>
          <dl className="rc-facts">
            <div>
              <dt>Route</dt>
              <dd>PayPal Payouts</dd>
            </div>
            <div>
              <dt>payout batch id</dt>
              <dd className="tabular rc-mono">{r.batchId}</dd>
            </div>
            <div>
              <dt>payout item id</dt>
              <dd className="tabular rc-mono">{r.itemId}</dd>
            </div>
            <div>
              <dt>PayPal status</dt>
              <dd className="tabular">{r.status}</dd>
            </div>
            <div>
              <dt>Recorded by</dt>
              <dd>
                <code>{r.suite}</code>, {r.passed} of {r.steps.length} steps passed, against a {r.base}
              </dd>
            </div>
          </dl>
          <ol className="rc-events">
            {r.steps.map((s) => (
              <li key={s.step}>
                <span>{s.step}</span>
                <span className="muted tabular">{(s.at_ms / 1000).toFixed(1)} s</span>
              </li>
            ))}
          </ol>
          <p className="cl-hint">
            Read from <code>{r.source}</code>, the run&rsquo;s redacted transcript, so this receipt opens the same on every copy of Remedy.
          </p>
        </section>
      </div>

      <p className="page-note">{SANDBOX_LABEL} This is a recorded receipt: press Send on the sample charger at /try for a new sandbox payout of your own.</p>
      <p className="rc-next">
        <Link className="text-link" href="/try">
          Try a photo
        </Link>
        <Link className="text-link" href="/evidence#measured">
          How payouts were measured
        </Link>
      </p>
    </div>
  );
}
