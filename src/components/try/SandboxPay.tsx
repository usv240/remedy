"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TryPayoutResult, TryReceipt } from "@/app/api/try/_lib/sandbox-payout";

/**
 * "Send $34.99 to the sandbox buyer", under the verified sample charger on /try: a real PayPal sandbox payout through
 * POST /api/try/sandbox-payout, then the receipt with PayPal's batch id and live status. Past today's limit, the most
 * recent sandbox payout's receipt instead.
 */
export function SandboxPay({ amount, payee }: { amount: string; payee: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ plain: string; receipt: TryReceipt | null; sent: boolean } | null>(null);

  async function send() {
    setBusy(true);
    setOut(null);
    try {
      const r = await fetch("/api/try/sandbox-payout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = (await r.json()) as { data: TryPayoutResult | null; error: { message: string } | null };
      if (!j.data) {
        setOut({ plain: j.error?.message ?? "The sandbox payout could not be sent just now.", receipt: null, sent: false });
        return;
      }
      setOut({ plain: j.data.plain, receipt: j.data.receipt, sent: j.data.sent });
      if (j.data.sent) router.push(j.data.receipt.url);
    } catch {
      setOut({ plain: "The sandbox payout could not be sent just now. Please try again.", receipt: null, sent: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tr-pay" data-ui>
      <p className="tr-pay-head">
        <span className="pill" data-tone="info">
          Sandbox payout
        </span>{" "}
        Send this refund through PayPal
      </p>
      <p className="tr-pay-note">
        A real PayPal sandbox payout of {amount} to the sandbox buyer{payee ? <span className="tabular">, {payee}</span> : null}: practice money, sent through PayPal&rsquo;s Payouts API by the same router and payouts code every claim uses. One a day per visitor.
      </p>
      <p className="tr-pay-actions">
        <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy} aria-describedby="tr-pay-state">
          {busy ? "Sending to PayPal" : `Send ${amount} to the sandbox buyer`}
        </button>
        {/* RECORDED_RECEIPT_URL in src/lib/recorded-receipt.ts: a receipt to look at without sending anything. */}
        <Link className="text-link" href="/r/recorded">
          See a recorded receipt
        </Link>
      </p>
      <p id="tr-pay-state" className="tr-pay-state" role="status" aria-live="polite">
        {out && (
          <>
            {out.sent ? "Sent. Opening the receipt." : out.plain}
            {out.receipt && (
              <>
                {" "}
                <Link className="text-link" href={out.receipt.url}>
                  {out.sent ? "The receipt" : "The latest receipt"}
                </Link>
                <span className="tabular muted">
                  {out.receipt.batchId ? `, PayPal batch ${out.receipt.batchId}` : ""}
                  {out.receipt.status ? `, ${out.receipt.status}` : ""}
                </span>
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
