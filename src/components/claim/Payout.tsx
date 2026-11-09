"use client";

import { useId, useState, type ReactNode } from "react";
import type { ClaimView, PayView, ReplacementOption } from "@/app/api/claims/_lib/types";
import { payerWords } from "@/lib/recall/label";
import { ClaimInfo } from "./ClaimInfo";
import { day, money } from "./format";

type Choice = "refund" | "email" | "phone" | "venmo" | "replacement";
type Options = { mode: string; query: string; max_price: string; options: ReplacementOption[]; excluded: number; note: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phoneOk = (v: string) => {
  const d = v.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(n);
};

/**
 * Where the refund goes. Verified: the money moves when "Send my refund" is pressed. Firm review: the owner leaves
 * where to send it, and the firm's approval sends it. A linked PayPal purchase is refunded to itself.
 */
export function Payout({ claim, review = false, onDone }: { claim: ClaimView; review?: boolean; onDone: (p: PayView) => void }) {
  const linked = claim.link?.status === "linked" ? claim.link : null;
  const [choice, setChoice] = useState<Choice>(linked ? "refund" : "email");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opts, setOpts] = useState<Options | null>(null);
  const [optsState, setOptsState] = useState<"idle" | "loading" | "error">("idle");
  const [pick, setPick] = useState<string>("");
  const name = useId();
  const inputId = useId();
  const hintId = useId();
  const errId = useId();

  const needsValue = choice === "email" || choice === "phone" || choice === "venmo";
  const valid = choice === "refund" || (choice === "replacement" ? Boolean(pick) : choice === "email" ? EMAIL.test(value.trim()) : phoneOk(value));

  async function loadOptions() {
    if (opts || optsState === "loading") return;
    setOptsState("loading");
    try {
      const r = await fetch(`/api/claims/${claim.id}/replacements`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message);
      setOpts(j.data);
      setOptsState("idle");
    } catch {
      setOptsState("error");
    }
  }

  function choose(c: Choice) {
    setChoice(c);
    setError("");
    if (c === "replacement") void loadOptions();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError(choice === "email" ? "Please enter the email of your PayPal account." : choice === "replacement" ? "Please pick a replacement." : "Please enter a 10-digit US phone number.");
      return;
    }
    setBusy(true);
    setError("");
    const body =
      choice === "refund" ? { choice: "money" } : choice === "replacement" ? { choice: "replacement", replacement_id: pick } : { choice: "money", payee_type: choice, payee: value.trim() };
    try {
      const r = await fetch(`/api/claims/${claim.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.error?.message ?? "The refund could not be sent just now. Please try again.");
        setBusy(false);
        return;
      }
      onDone(j.data as PayView);
    } catch {
      setError("Your connection dropped before the refund was sent. Please try again; it will never be paid twice.");
      setBusy(false);
    }
  }

  const label = choice === "email" ? "Email of your PayPal account" : choice === "venmo" ? "Phone number on your Venmo account" : "Phone number on your PayPal account";
  const options: { id: Choice; title: string; sub: ReactNode }[] = [
    ...(linked ? [{ id: "refund" as const, title: "Back to your PayPal payment", sub: `Your purchase on ${day(linked.paid_at)}, ${money(linked.amount)}. PayPal returns it the way you paid.` }] : []),
    { id: "email", title: "PayPal, by email", sub: "Sent to the PayPal account for your email." },
    { id: "phone", title: "PayPal, by phone", sub: "Sent to the PayPal account for your phone number." },
    {
      id: "venmo",
      title: "Venmo",
      sub: (
        <>
          By phone number. Falls back to a PayPal phone payout in the sandbox.
          <span className="cl-tech"> The sandbox refuses recipient_wallet VENMO, so the payout is resent as recipient_type PHONE to the same number (src/lib/payments/payouts.ts); live PayPal would deliver it to Venmo.</span>
        </>
      ),
    },
    ...(!review ? [{ id: "replacement" as const, title: "A safe replacement", sub: `A similar product at or under ${money(claim.amount?.value)}, with no active recall.` }] : []),
  ];

  return (
    <form className="cl-payout" onSubmit={send} noValidate data-ui>
      <fieldset className="cl-choices">
        <legend className="cl-legend">
          {review ? "Where should the refund go once it is approved?" : "Where should it go?"} <ClaimInfo k="claim.route" topic="where the refund goes" />
        </legend>
        {options.map((o) => (
          <label key={o.id} className="cl-choice" data-on={choice === o.id ? "" : undefined}>
            <input type="radio" name={name} value={o.id} checked={choice === o.id} onChange={() => choose(o.id)} />
            <span className="cl-choice-text">
              <span className="cl-choice-title">{o.title}</span>
              <span className="cl-choice-sub">{o.sub}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {needsValue && (
        <div className="cl-field">
          <label htmlFor={inputId}>{label}</label>
          <input
            id={inputId}
            type={choice === "email" ? "email" : "tel"}
            inputMode={choice === "email" ? "email" : "tel"}
            autoComplete={choice === "email" ? "email" : "tel"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={choice === "email" ? "you@example.com" : "(415) 555-0134"}
            aria-describedby={`${hintId}${error ? ` ${errId}` : ""}`}
            aria-invalid={error ? true : undefined}
          />
          <p id={hintId} className="cl-hint">
            {choice === "email" ? "No PayPal account yet? PayPal emails you a link to accept it." : "A 10-digit US number."} We keep it encrypted and show it masked.
          </p>
        </div>
      )}

      {choice === "replacement" && (
        <div className="cl-replace">
          <p className="cl-replace-k">
            Safe replacements <ClaimInfo k="claim.replacement" topic="safe replacements" />
          </p>
          {optsState === "loading" && (
            <ul className="cl-replace-list" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="cl-replace-skel" aria-hidden="true" />
              ))}
            </ul>
          )}
          {optsState === "error" && (
            <p className="cl-note" role="alert">
              Replacements could not load just now.{" "}
              <button type="button" className="cl-textbtn" onClick={() => { setOptsState("idle"); void loadOptions(); }}>
                Try again
              </button>
            </p>
          )}
          {opts && opts.options.length === 0 && <p className="cl-note">{opts.note ?? `No in-stock replacement at or under ${money(opts.max_price)} passed the recall check right now. A refund works just as well.`}</p>}
          {opts && opts.options.length > 0 && (
            <>
              <ul className="cl-replace-list">
                {opts.options.map((o) => (
                  <li key={o.id}>
                    <label className="cl-product" data-on={pick === o.id ? "" : undefined}>
                      <input type="radio" name={`${name}-r`} value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} />
                      {/* eslint-disable-next-line @next/next/no-img-element -- retailer images from Channel3, any host */}
                      {o.image ? <img src={o.image} alt={o.image_alt ?? ""} width={64} height={64} loading="lazy" /> : <span className="cl-product-noimg" aria-hidden="true" />}
                      <span className="cl-product-text">
                        <span className="cl-product-title">{o.title}</span>
                        <span className="cl-product-sub">
                          <span className="tabular">{money(o.price)}</span>
                          {o.retailer ? ` at ${o.retailer}` : ""} <span className="pill" data-tone="positive">{o.recall_check.plain}</span>
                        </span>
                        <span className="cl-tech cl-product-tech">{o.recall_check.technical}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="cl-hint">
                From Channel3, in stock, at or under {money(opts.max_price)}, each checked against Remedy&rsquo;s recall search
                {opts.excluded ? `; ${opts.excluded} that may match a recall were left out` : ""}.
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p id={errId} className="cl-error" role="alert">
          {error}
        </p>
      )}
      <div className="cl-actions">
        <button type="submit" className="btn btn-primary cl-send" disabled={busy} aria-disabled={!valid || undefined}>
          {busy ? (review ? "Saving" : "Sending") : review ? "Save where to send it" : choice === "replacement" ? "Order my replacement" : "Send my refund"}
        </button>
      </div>
      <p className="cl-fine">
        {payerWords(claim.recall.number).demo} {claim.sandbox_label}
      </p>
    </form>
  );
}
