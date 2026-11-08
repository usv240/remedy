"use client";

import { useId, useState } from "react";

type Account = { mode: "own"; clientIdTail: string; connectedAt: string } | { mode: "platform"; note: string };

/**
 * Connect the firm's own PayPal REST app (sandbox): the client ID and secret go to /api/firm/paypal, PayPal checks
 * them, and the server seals them. The secret is never shown again; only the last four characters of the client ID.
 */
export function PaypalConnect({ initial, sample }: { initial: Account; sample: boolean }) {
  const [account, setAccount] = useState<Account>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "positive" | "attention"; text: string } | null>(null);
  const id = useId();

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/firm/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: String(data.get("client_id") ?? ""), secret: String(data.get("secret") ?? "") }),
      });
      const j = (await res.json().catch(() => null)) as { data?: { account: Account; plain: string }; error?: { message?: string } } | null;
      if (res.ok && j?.data) {
        setAccount(j.data.account);
        setStatus({ tone: "positive", text: j.data.plain });
        form.reset();
        if (j.data.account.mode === "own") setOpen(false);
      } else setStatus({ tone: "attention", text: j?.error?.message ?? "That did not work. Please try again." });
    } catch {
      setStatus({ tone: "attention", text: "The server could not be reached. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    const res = await fetch("/api/firm/paypal", { method: "DELETE" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { data?: { account: Account } } | null;
    if (j?.data) setAccount(j.data.account);
    setStatus({ tone: "positive", text: "Disconnected. Refunds and payouts come from the platform's sandbox account again." });
    setBusy(false);
  }

  return (
    <div className="pp-connect">
      {account.mode === "own" ? (
        <p>
          Paid from <strong>your PayPal app</strong> ending <span className="tabular">{account.clientIdTail}</span>, sandbox. Refunds to the original purchase and payouts both run on it.
        </p>
      ) : (
        <p>
          Paid from <strong>Remedy&rsquo;s PayPal sandbox account</strong>.{" "}
          {sample ? "Brightline Home is the sample firm, so it keeps the platform account." : "Connect your own PayPal app to pay refunds from your own account."}
        </p>
      )}
      <div className="pp-actions">
        {account.mode === "own" ? (
          <button type="button" className="btn btn-quiet" onClick={() => void disconnect()} disabled={busy}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="btn btn-quiet" aria-expanded={open} aria-controls={`${id}-form`} onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : "Connect your PayPal app"}
          </button>
        )}
      </div>
      {open && account.mode !== "own" && (
        <form
          id={`${id}-form`}
          className="firm-form pp-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(e.currentTarget);
          }}
        >
          <label className="firm-field wide">
            Client ID
            <input name="client_id" autoComplete="off" spellCheck={false} required minLength={20} maxLength={100} />
          </label>
          <label className="firm-field wide">
            Secret
            <input name="secret" type="password" autoComplete="off" required minLength={20} maxLength={100} />
          </label>
          <button type="submit" className="btn btn-ink" disabled={busy}>
            {busy ? "Checking with PayPal…" : "Check and connect"}
          </button>
          <p className="muted pp-note">
            From your app in the PayPal developer dashboard, sandbox. PayPal checks the pair first; it is stored sealed and never shown again.
            {sample ? " On this sample firm the pair is only checked, never stored." : ""}
          </p>
        </form>
      )}
      <p className="firm-status" role="status" data-tone={status?.tone}>
        {status?.text ?? ""}
      </p>
    </div>
  );
}
