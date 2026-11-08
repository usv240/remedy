"use client";

import { useEffect, useRef, useState } from "react";
import type { ClaimView } from "@/app/api/claims/_lib/types";
import { ClaimInfo } from "./ClaimInfo";
import { money, payeeWords, reviewWindow, when } from "./format";

/** The receipt's headline, worded from where the refund really is. */
export function headline(c: ClaimView): { title: string; pill: { word: string; tone: string }; sub: string } {
  const p = c.payment;
  const amount = money(p?.amount ?? c.amount?.value);
  if (c.decision === "retake") return { title: "This photo needs a retake.", pill: { word: "Retake", tone: "attention" }, sub: c.guidance?.plain ?? "Please take the photo again." };
  if (c.decision === "pending") return { title: "Your photo is being checked.", pill: { word: "Checking", tone: "info" }, sub: "This takes a few seconds." };
  if (!p) {
    return c.decision === "verified"
      ? { title: "Your photo checks out.", pill: { word: "Verified", tone: "positive" }, sub: "Choose where your refund goes to send it." }
      : { title: `Waiting for ${c.firm.name}.`, pill: { word: "Firm review", tone: "info" }, sub: `A person at ${c.firm.name} will take a look, ${reviewWindow(c.firm.review_hours)}.` };
  }
  if (p.plan_status === "awaiting_approval") return { title: `Waiting for ${c.firm.name}.`, pill: { word: "Firm review", tone: "info" }, sub: `Your ${amount} refund is sent as soon as it is approved, ${reviewWindow(c.firm.review_hours)}.` };
  if (p.status === "paid") {
    if (p.route === "refund") return { title: `Refunded ${amount} to your PayPal payment.`, pill: { word: "Refunded", tone: "paid" }, sub: "PayPal returns it the way you paid." };
    if (p.route === "replacement") return { title: "Your safe replacement is paid for.", pill: { word: "Replacement paid", tone: "paid" }, sub: `${c.firm.name.charAt(0).toUpperCase()}${c.firm.name.slice(1)} paid ${p.replacement?.retailer ?? "the retailer"}, who ships it to you.` };
    return { title: `Paid ${amount} to ${p.payee?.type === "venmo" ? "your Venmo" : "your PayPal"}.`, pill: { word: "Paid", tone: "paid" }, sub: `Sent to ${payeeWords(p.payee)}.` };
  }
  if (p.status === "unclaimed") return { title: `Your ${amount} refund is waiting for you.`, pill: { word: "Waiting to be accepted", tone: "attention" }, sub: "PayPal emailed you a link to accept it. We will send a friendly reminder too." };
  if (p.status && ["failed", "blocked", "returned", "canceled", "reversed"].includes(p.status)) return { title: "Your refund needs another way.", pill: { word: p.status_label ?? "Needs another way", tone: "attention" }, sub: `${p.status_plain ?? ""} A person at ${c.firm.name} will follow up.`.trim() };
  return { title: `Your ${amount} refund is on its way.`, pill: { word: "On its way", tone: "info" }, sub: p.route === "refund" ? "PayPal is refunding your purchase now." : "PayPal is sending it now. This usually takes under half a minute." };
}

function idLine(c: ClaimView) {
  const p = c.payment;
  if (!p) return null;
  if (p.route === "refund" && p.ids.refund_id) return `Sandbox refund ID ${p.ids.refund_id}`;
  if (p.route === "replacement" && p.ids.order_id) return `Sandbox order ID ${p.ids.order_id}`;
  if (p.ids.payout_item_id) return `Sandbox payout ID ${p.ids.payout_item_id}`;
  if (p.ids.payout_batch_id) return `Sandbox payout batch ${p.ids.payout_batch_id}`;
  return null;
}

/** Ask every 3 s for the first 30 s, then every 8 s, until PayPal says the money landed (or 5 minutes pass). */
const delayFor = (ms: number) => (ms < 30_000 ? 3000 : ms < 120_000 ? 8000 : ms < 300_000 ? 15000 : null);

const isOpen = (c: ClaimView) => {
  const p = c.payment;
  if (!p) return false;
  if (p.plan_status === "awaiting_approval") return true;
  return !p.final || p.status === "unclaimed";
};

export function ReceiptLive({ initial }: { initial: ClaimView }) {
  const [c, setC] = useState(initial);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const started = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    started.current = performance.now();
    let alive = true;
    const tick = async () => {
      const r = await fetch(`/api/claims/${initial.id}?refresh=1`).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (!alive) return;
      if (j?.data) {
        setC(j.data);
        setCheckedAt(new Date().toISOString());
      }
      const next = j?.data ?? initial;
      const d = delayFor(performance.now() - started.current);
      if (isOpen(next) && d) timer.current = window.setTimeout(tick, d);
      else if (isOpen(next)) setStopped(true);
    };
    if (isOpen(initial)) timer.current = window.setTimeout(tick, 1200);
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, [initial]);

  const h = headline(c);
  const ids = idLine(c);
  const paid = c.payment?.status === "paid";
  return (
    <header className="rc-head" data-paid={paid ? "" : undefined}>
      <p className="rc-pill" aria-live="polite">
        <span className="pill" data-tone={h.pill.tone}>
          {h.pill.word}
        </span>
        <ClaimInfo k="claim.receipt" topic="this receipt" />
      </p>
      <h1 className="rc-title" aria-live="polite">
        {h.title}
      </h1>
      <p className="rc-sub">{h.sub}</p>
      {ids && <p className="rc-id tabular">{ids}</p>}
      {paid && <p className="rc-thanks">Thank you for keeping your home safe.</p>}
      <p className="rc-fresh muted" data-ui>
        {isOpen(c) ? (stopped ? "Still waiting on PayPal. " : "Checking PayPal every few seconds. ") : ""}
        {checkedAt ? `Last checked ${when(checkedAt)}.` : ""}
        {stopped && (
          <button type="button" className="cl-textbtn" onClick={() => location.reload()}>
            Check again
          </button>
        )}
      </p>
    </header>
  );
}
