"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CHECK_LABEL, CHECK_ORDER, passCount, REVIEWERS_LABEL, REVIEWERS_PLAIN } from "@/lib/firm/checks";
import { SAMPLE_REVIEWER, STAGE_LABEL, STAGE_TONE, type QueueRow } from "@/lib/firm/types";
import { ClaimDrawer } from "./ClaimDrawer";
import type { GridHandle } from "./ClaimsGrid";
import { FirmInfo } from "./FirmInfo";
import { Thumb } from "./Thumb";

const ClaimsGrid = dynamic(() => import("./ClaimsGrid").then((m) => m.ClaimsGrid), {
  ssr: false,
  loading: () => null,
});

export type View = "all" | "review" | "ready" | "paid_today" | "unclaimed";
const DAY = 86_400_000;

/** The quick views. Each is a filter over the same rows. */
export const VIEWS: { id: View; label: string; test: (r: QueueRow, now: number) => boolean }[] = [
  { id: "all", label: "All claims", test: () => true },
  { id: "review", label: "Needs review", test: (r) => r.stage === "needs_review" },
  { id: "ready", label: "Ready to pay", test: (r) => r.payable },
  { id: "paid_today", label: "Paid today", test: (r, now) => r.stage === "paid" && Boolean(r.payout.paidAt) && now - Date.parse(r.payout.paidAt!) < DAY },
  { id: "unclaimed", label: "Waiting to be accepted", test: (r) => r.stage === "unclaimed" },
];

const NARROW = "(max-width: 760px)";
const watch = (cb: () => void) => {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const REVIEWER_KEY = "remedy-firm-reviewer";
const usd = (c: number | null) => (c === null ? "" : `$${(c / 100).toFixed(2)}`);
const TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const DAY_UTC = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The first rows of the queue, rendered on the server so the page shows claims at once, in the grid's own columns. */
function FirstRows({ rows, total }: { rows: QueueRow[]; total: number }) {
  return (
    <div className="cq-first" aria-hidden="true">
      <table>
        <thead>
          <tr>
            <th>Photo</th>
            <th>Claimant and recall</th>
            <th>Checks</th>
            <th>Reviewers</th>
            <th>Decision</th>
            <th className="num">Amount</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Thumb url={r.photoUrl} made={r.checks.C2 === "pass"} size={36} label="" />
              </td>
              <td>
                <span className="cq-first-who">{r.claimant}</span>
                <span className="muted">
                  {" "}
                  {r.recallShort}
                  {r.sample ? ", sample" : ""}
                </span>
              </td>
              <td className="tabular">{passCount(r.checks)} of 6</td>
              <td>{REVIEWERS_LABEL[r.reviewers]}</td>
              <td>
                <span className="pill" data-tone={STAGE_TONE[r.stage]}>
                  {STAGE_LABEL[r.stage]}
                </span>
              </td>
              <td className="num tabular">{usd(r.amountCents)}</td>
              <td className="tabular muted">{DAY_UTC.format(new Date(r.submittedAt))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length && <p className="muted cq-first-more">{total - rows.length} more</p>}
    </div>
  );
}

export function ClaimsQueue({ initial, initialView }: { initial: QueueRow[]; initialView: View }) {
  const [rows, setRows] = useState(initial);
  // The server renders the first rows as a plain table; AG Grid takes over once it has drawn its own.
  const [gridReady, setGridReady] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone?: "attention" | "positive" } | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [shown, setShown] = useState(20);
  const narrow = useSyncExternalStore(watch, () => window.matchMedia(NARROW).matches, () => false);
  const grid = useRef<GridHandle | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const r = localStorage.getItem(REVIEWER_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (r === SAMPLE_REVIEWER) setReviewer(r);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const j = (await (await fetch("/api/firm/claims", { cache: "no-store" })).json()) as { data: { claims: QueueRow[] } | null };
      if (j.data) {
        setRows(j.data.claims);
        setNow(Date.now());
      }
    } catch {
      /* the next event tries again */
    }
  }, []);

  // Live payout status: each payment event updates its row, then the rows are read again once things settle.
  useEffect(() => {
    const es = new EventSource("/api/firm/live");
    let timer: ReturnType<typeof setTimeout> | null = null;
    es.addEventListener("ready", () => setLive(true));
    es.addEventListener("payment", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { claimId: string; status: QueueRow["payout"]["status"]; label: string };
      setRows((list) => list.map((r) => (r.id === d.claimId ? { ...r, payout: { ...r.payout, status: d.status, label: d.label } } : r)));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), 600);
    });
    es.onerror = () => setLive(false);
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [reload]);

  const test = useMemo(() => VIEWS.find((v) => v.id === view)!.test, [view]);
  const filter = useCallback((r: QueueRow) => test(r, now), [test, now]);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, rows.filter((r) => v.test(r, now)).length])) as Record<View, number>, [rows, now]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => filter(r) && (!q || `${r.claimant} ${r.recallShort} ${r.recallNumber} ${STAGE_LABEL[r.stage]} ${r.decision}`.toLowerCase().includes(q)));
  }, [rows, filter, search]);
  const payableSelected = selected.filter((id) => rows.find((r) => r.id === id)?.payable);
  const selectedTotal = payableSelected.reduce((s, id) => s + (rows.find((r) => r.id === id)?.amountCents ?? 0), 0);
  const readyCount = counts.ready;
  const openRow = rows.find((r) => r.id === open) ?? null;

  const onOpen = useCallback((id: string, from: HTMLElement | null) => {
    opener.current = from;
    setOpen(id);
  }, []);
  const onClose = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);

  function chooseView(v: View) {
    setView(v);
    const u = new URL(window.location.href);
    if (v === "all") u.searchParams.delete("view");
    else u.searchParams.set("view", v);
    window.history.replaceState(null, "", u);
  }

  function signIn(r: string | null) {
    setReviewer(r);
    try {
      if (r) localStorage.setItem(REVIEWER_KEY, r);
      else localStorage.removeItem(REVIEWER_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  async function paySelected(ids: string[]) {
    if (!ids.length || !reviewer) return;
    setBusy(true);
    setStatus({ text: `Approving ${ids.length} ${ids.length === 1 ? "claim" : "claims"} and sending one PayPal Payouts batch…` });
    try {
      const r = await fetch("/api/firm/claims/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claim_ids: ids, reviewer }) });
      const j = (await r.json()) as { data: { results: { ok: boolean; kind: string; plain: string; batchId: string | null }[]; sent: number } | null; error: { message: string } | null };
      if (!j.data) setStatus({ text: j.error?.message ?? "The payments could not be started.", tone: "attention" });
      else {
        const sent = j.data.results.filter((x) => x.kind === "sent");
        const batch = sent.find((x) => x.batchId)?.batchId;
        const other = j.data.results.filter((x) => !x.ok);
        setStatus({
          text: `${sent.length} ${sent.length === 1 ? "payout" : "payouts"} sent${batch ? ` in PayPal batch ${batch}` : ""}. ${other.length ? `${other.length} not sent: ${other[0].plain}` : "Each one shows Paid here when PayPal confirms it, usually within a minute."}`,
          tone: other.length && !sent.length ? "attention" : "positive",
        });
        grid.current?.clearSelection();
        setSelected([]);
      }
      await reload();
    } catch {
      setStatus({ text: "The payments could not be started. Please try again.", tone: "attention" });
    } finally {
      setBusy(false);
    }
  }

  const stamp = openRow ? `${openRow.stage}:${openRow.payout.status ?? ""}:${openRow.reviewOutcome ?? ""}` : "";

  return (
    <div className="cq">
      <div className="cq-views" role="group" aria-label="Quick views">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className="cq-view" aria-pressed={view === v.id} onClick={() => chooseView(v.id)}>
            <span className="cq-view-label">{v.label}</span>
            <span className="cq-view-count">{counts[v.id]}</span>
          </button>
        ))}
      </div>

      <div className="cq-tools">
        <label className="firm-field" style={{ flex: "1 1 16rem", maxWidth: "22rem" }}>
          Search claims
          <input className="cq-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, recall or status" />
        </label>
        <p className="cq-signin" aria-live="polite">
          {reviewer ? (
            <>
              <span className="cq-signin-dot" aria-hidden="true" />
              <span>
                Signed in as <strong>{reviewer}</strong> <span className="muted">(sample reviewer)</span>
              </span>
              <button type="button" className="cq-open" onClick={() => signIn(null)}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => signIn(SAMPLE_REVIEWER)} data-testid="sign-in">
              Sign in as {SAMPLE_REVIEWER} (sample reviewer)
            </button>
          )}
          <FirmInfo id="firm.sign-in" label="" />
        </p>
        <p className="cq-live" aria-live="polite">
          <span className="plan-dot" data-on={live ? "" : undefined} aria-hidden="true" />
          {live ? "Live: payout status updates here" : "Connecting for live updates"}
        </p>
      </div>

      <div className="cq-bulk" role="region" aria-label="Bulk actions">
        <span className="cq-bulk-text">
          {payableSelected.length
            ? `${payableSelected.length} selected, ${usd(selectedTotal)}${reviewer ? "" : ". Sign in to approve."}`
            : readyCount
              ? `${readyCount} verified ${readyCount === 1 ? "claim is" : "claims are"} ready to pay.`
              : "No verified claims are waiting to be paid."}
        </span>
        <span className="firm-actions">
          {!narrow && readyCount > 0 && payableSelected.length === 0 && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                chooseView("ready");
                setTimeout(() => grid.current?.selectPayable(), 60);
              }}
            >
              Select all ready to pay
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !payableSelected.length || !reviewer}
            onClick={() => void paySelected(payableSelected)}
            data-testid="approve-and-pay"
            title={reviewer ? undefined : "Sign in as the sample reviewer first"}
          >
            {busy ? "Sending…" : payableSelected.length ? `Approve and pay ${payableSelected.length}` : "Approve and pay"}
          </button>
          <FirmInfo id="firm.approve-pay" label="" />
        </span>
        {status && (
          <p className="firm-status" role="status" data-tone={status.tone} style={{ flexBasis: "100%" }}>
            {status.text}
          </p>
        )}
      </div>

      {/* The Technical view's key to the check chips: each check's id and short name. */}
      <p className="cq-legend">
        {CHECK_ORDER.map((id) => (
          <span key={id}>
            <strong>{id}</strong> {CHECK_LABEL[id].short}
          </span>
        ))}
      </p>
      <p className="cq-total" style={{ marginTop: 12 }}>
        {visible.length} of {rows.length} claims shown.{" "}
        {!narrow && (
          <button type="button" className="cq-open" onClick={() => grid.current?.exportCsv()} style={{ color: "var(--link)" }}>
            Download this view as CSV
          </button>
        )}
      </p>

      {narrow ? (
        <ul className="cq-cards" aria-label="Claims">
          {visible.slice(0, shown).map((r) => (
            <li key={r.id} className="cq-card">
              <Thumb url={r.photoUrl} made={r.checks.C2 === "pass"} size={48} label={`Photo from ${r.claimant}`} />
              <div>
                <p className="cq-card-who">{r.claimant}</p>
                <p className="cq-card-meta">
                  {r.recallShort}
                  {r.sample ? ", sample" : ""}
                </p>
                <p className="cq-card-meta">
                  {passCount(r.checks)} of 6 checks pass. {TIME.format(new Date(r.submittedAt))}
                </p>
                {r.reviewers !== "not_needed" && <p className="cq-card-meta">Reviewers: {REVIEWERS_PLAIN[r.reviewers]}</p>}
              </div>
              <p className="cq-card-amt">{usd(r.amountCents)}</p>
              <div className="cq-card-foot">
                <span className="pill" data-tone={STAGE_TONE[r.stage]}>
                  {STAGE_LABEL[r.stage]}
                </span>
                <span className="firm-actions">
                  {r.payable && (
                    <label className="cq-card-select">
                      <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
                      Select
                    </label>
                  )}
                  <button type="button" className="btn btn-quiet" onClick={(e) => onOpen(r.id, e.currentTarget)}>
                    Open
                  </button>
                </span>
              </div>
            </li>
          ))}
          {visible.length > shown && (
            <li>
              <button type="button" className="btn btn-quiet" style={{ width: "100%" }} onClick={() => setShown((n) => n + 20)}>
                Show {Math.min(20, visible.length - shown)} more of {visible.length - shown}
              </button>
            </li>
          )}
          {visible.length === 0 && <li className="muted">No claims in this view.</li>}
        </ul>
      ) : (
        <div className="cq-grid" data-ready={gridReady ? "" : undefined}>
          {!gridReady && <FirstRows rows={visible.slice(0, 14)} total={visible.length} />}
          <ClaimsGrid handleRef={grid} rows={rows} search={search} filter={filter} onOpen={onOpen} onSelection={setSelected} onReady={() => setGridReady(true)} />
        </div>
      )}

      <ClaimDrawer claimId={open} stamp={stamp} reviewer={reviewer} onSignIn={() => signIn(SAMPLE_REVIEWER)} onClose={onClose} onChanged={() => void reload()} />
    </div>
  );
}
