"use client";

import Papa from "papaparse";
import { useRef, useState } from "react";
import type { BuyerLine } from "@/lib/firm/buyers";
import type { NoticeLink } from "@/lib/firm/buyers-data";
import { noticeCsv, noticeFileName, type NoticeRow } from "@/lib/firm/notices";
import { FirmInfo } from "./FirmInfo";

type Line = BuyerLine & { saleId: number | null };
type PayPalBuyer = { buyerEmail: string | null; item: string; amountCents: number; paidAt: string; captureId: string; matchScore: number; refundable: boolean };
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (iso: string) => DAY.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));

/**
 * Each sales-file line's address and order id, read again in the browser from the firm's own file, by the same line
 * numbers the server uses (the header is line 1). Remedy's server never returns a buyer's full address.
 */
async function fileContacts(f: File | undefined): Promise<Map<number, { contact: string; orderId: string | null }>> {
  const out = new Map<number, { contact: string; orderId: string | null }>();
  if (!f) return out;
  const parsed = Papa.parse<Record<string, string>>((await f.text()).replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
  parsed.data.slice(0, 5000).forEach((r, i) => {
    const contact = (r.buyer_email ?? "").trim() || (r.buyer_phone ?? "").trim();
    if (contact) out.set(i + 2, { contact, orderId: (r.order_id ?? "").trim() || null });
  });
  return out;
}

/** The notices as rows for the download: the address from the firm's own file where it has one, masked otherwise. */
function noticeRows(links: NoticeLink[], lines: Line[] | null, contacts: Map<number, { contact: string; orderId: string | null }>): NoticeRow[] {
  const lineOf = new Map((lines ?? []).filter((l) => l.saleId).map((l) => [l.saleId!, l]));
  return links
    .filter((l) => l.status === "ready")
    .map((l) => {
      const line = lineOf.get(l.saleId) ?? null;
      const own = line ? contacts.get(line.line) : undefined;
      return { saleId: l.saleId, line: line?.line ?? null, orderId: own?.orderId ?? line?.orderId ?? null, channel: l.channel, contact: own?.contact ?? l.contact, link: l.link, subject: l.subject, body: l.message, refundToOriginal: l.refundToOriginal };
    });
}

export function BuyersImport({ recall, product, today, firmName }: { recall: string; product: string; today: string; firmName: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [summary, setSummary] = useState<{ total: number; matched: number; warnings: string[] } | null>(null);
  const [links, setLinks] = useState<NoticeLink[] | null>(null);
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [busy, setBusy] = useState<"idle" | "upload" | "notify" | "paypal">("idle");
  const [status, setStatus] = useState<{ text: string; tone?: "attention" | "positive" } | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [pp, setPp] = useState<{ buyers: PayPalBuyer[]; scanned: number; note: string; imported: { created: number } | null } | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const f = file.current?.files?.[0];
    if (!f) return setStatus({ text: "Choose a CSV file first. The template shows every column.", tone: "attention" });
    setBusy("upload");
    setLinks(null);
    setStatus({ text: `Reading ${f.name}…` });
    try {
      const body = new FormData();
      body.set("file", f);
      const r = await fetch(`/api/firm/buyers/import?recall=${recall}`, { method: "POST", body });
      const j = (await r.json()) as { data: { total: number; matched: number; lines: Line[]; warnings: string[] } | null; error: { message: string } | null };
      if (!j.data) return setStatus({ text: j.error?.message ?? "The file could not be read.", tone: "attention" });
      setLines(j.data.lines);
      setSummary({ total: j.data.total, matched: j.data.matched, warnings: j.data.warnings });
      setStatus({ text: `${j.data.matched} of ${j.data.total} lines match the recalled product. Matched buyers are saved as sales, with contacts kept encrypted.`, tone: "positive" });
    } catch {
      setStatus({ text: "The file could not be read. Please try again.", tone: "attention" });
    } finally {
      setBusy("idle");
    }
  }

  async function notify() {
    const ids = (lines ?? []).filter((l) => l.matched && l.saleId).map((l) => l.saleId!);
    if (!ids.length) return;
    setBusy("notify");
    try {
      const r = await fetch("/api/firm/buyers/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sale_ids: ids, recall }) });
      const j = (await r.json()) as { data: { links: NoticeLink[]; ready: number } | null; error: { message: string } | null };
      if (!j.data) return setStatus({ text: j.error?.message ?? "The notices could not be made.", tone: "attention" });
      setLinks(j.data.links);
      setRows(noticeRows(j.data.links, lines, await fileContacts(file.current?.files?.[0])));
      setStatus({ text: `${j.data.ready} ${j.data.ready === 1 ? "notice" : "notices"} ready, each with its own claim link. Download them below and send them from your mail tool.`, tone: "positive" });
    } catch {
      setStatus({ text: "The notices could not be made. Please try again.", tone: "attention" });
    } finally {
      setBusy("idle");
    }
  }

  async function searchPayPal(save: boolean) {
    setBusy("paypal");
    setStatus({ text: "Asking PayPal Transaction Search…" });
    try {
      const r = await fetch("/api/firm/buyers/paypal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: from, end: to, import: save, recall }) });
      const j = (await r.json()) as { data: { buyers: PayPalBuyer[]; scanned: number; note: string; imported: { created: number } | null } | null; error: { message: string } | null };
      if (!j.data) return setStatus({ text: j.error?.message ?? "PayPal did not answer just now.", tone: "attention" });
      setPp(j.data);
      setStatus({ text: `${j.data.buyers.length} ${j.data.buyers.length === 1 ? "buyer" : "buyers"} of the recalled product among ${j.data.scanned} PayPal transactions.${j.data.imported ? ` Saved ${j.data.imported.created} new sales.` : ""}`, tone: "positive" });
    } catch {
      setStatus({ text: "PayPal did not answer just now. Please try again.", tone: "attention" });
    } finally {
      setBusy("idle");
    }
  }

  const matched = (lines ?? []).filter((l) => l.matched);
  return (
    <>
      <section className="firm-section" aria-labelledby="by-csv">
        <h2 id="by-csv">From a sales file</h2>
        <p className="muted">One line per order. Lines that name {product}, or the sample shop&rsquo;s charger, are matched; everything else is left out.</p>
        <form className="by-drop" onSubmit={(e) => void upload(e)}>
          <label className="firm-field">
            Sales CSV
            <input ref={file} type="file" accept=".csv,text/csv" className="firm-input" data-testid="buyers-file" />
          </label>
          <button type="submit" className="btn btn-ink" disabled={busy !== "idle"}>
            {busy === "upload" ? "Reading…" : "Match buyers"}
          </button>
          <a className="firm-link" href="/api/firm/buyers/template" download>
            Download the template
          </a>
        </form>
      </section>

      <p className="firm-status" role="status" data-tone={status?.tone} style={{ marginTop: 12 }}>
        {status?.text ?? ""}
      </p>

      {lines && (
        <section className="firm-section" aria-labelledby="by-res">
          <h2 id="by-res">
            {matched.length} matched {matched.length === 1 ? "buyer" : "buyers"}
            {summary ? <span className="muted" style={{ fontWeight: 400 }}>&nbsp;of {summary.total} lines</span> : null}
          </h2>
          <div className="by-table-wrap" role="region" aria-labelledby="by-res" tabIndex={0}>
            <table className="by-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Item</th>
                  <th scope="col">Ordered</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col" className="num">
                    Match
                  </th>
                  <th scope="col">Refund</th>
                </tr>
              </thead>
              <tbody>
                {lines.slice(0, 200).map((l) => (
                  <tr key={l.line}>
                    <td className="num">{l.line}</td>
                    <td>{l.contact}</td>
                    <td>
                      {l.item}
                      {l.sku ? <span className="muted"> ({l.sku})</span> : null}
                    </td>
                    <td className="tabular">{l.orderDate ? day(l.orderDate) : "None"}</td>
                    <td className="num">{usd(l.amountCents)}</td>
                    <td className="num">{l.matched ? `${Math.round(l.score * 100)}%` : <span className="muted">No match</span>}</td>
                    <td>
                      {!l.matched ? (
                        <span className="muted">Not this recall</span>
                      ) : l.issue ? (
                        <span className="muted">{l.issue}</span>
                      ) : l.refundToOriginal ? (
                        <span className="pill" data-tone="info">
                          Refund to original payment after photo
                        </span>
                      ) : (
                        "PayPal or Venmo payout after photo"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {matched.length > 0 && (
            <p className="firm-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => void notify()} disabled={busy !== "idle"} data-testid="notify-buyers">
                {busy === "notify" ? "Making notices…" : `Make ${matched.length} ${matched.length === 1 ? "notice" : "notices"}`}
              </button>
              <FirmInfo id="firm.refund-original" label="" />
            </p>
          )}
        </section>
      )}

      {links && (
        <section className="firm-section" aria-labelledby="by-links">
          <h2 id="by-links">Notices ready to send ({rows.length})</h2>
          <p className="muted by-note">
            Remedy sends no mail. Download the notices for your own mail tool: one row for each buyer, with the address from your sales file, the subject, the text and the buyer&rsquo;s personal claim link. Each link is shown once; Remedy keeps
            only a fingerprint of it.
          </p>
          {rows.length > 0 && (
            <p className="firm-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => download(rows, recall, today)} data-testid="notice-csv">
                Download the notices (CSV)
              </button>
            </p>
          )}
          {rows[0] && <EmailPreview row={rows[0]} firmName={firmName} paragraphs={links.find((l) => l.saleId === rows[0].saleId)?.paragraphs ?? [rows[0].body]} />}
          <ul className="by-links" data-testid="notice-links">
            {links.map((l) => (
              <li key={l.saleId}>
                <span>
                  <strong>{l.contact}</strong> by {l.channel === "sms" ? "text" : "email"}
                  {l.status === "already_notified" ? <span className="muted">, already has a notice from an earlier download</span> : null}
                  {l.refundToOriginal ? <span className="muted">, refund to the original PayPal payment</span> : null}
                </span>
                {l.link && <span className="by-link">{l.link}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="firm-section" aria-labelledby="by-pp">
        <h2 id="by-pp">From PayPal</h2>
        <p className="muted">Buyers who paid Brightline Home with PayPal, from PayPal Transaction Search. PayPal&rsquo;s sandbox can take up to three hours to list a new purchase.</p>
        <form
          className="firm-form"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void searchPayPal(false);
          }}
        >
          <label className="firm-field">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label className="firm-field">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </label>
          <button type="submit" className="btn btn-ink" disabled={busy !== "idle"}>
            {busy === "paypal" ? "Searching…" : "Search PayPal"}
          </button>
        </form>
        {pp && (
          <>
            <ul className="firm-list" style={{ marginTop: 12, maxWidth: "48rem" }}>
              {pp.buyers.length === 0 && <li className="muted">No PayPal buyers of the recalled product in these dates yet.</li>}
              {pp.buyers.map((b) => (
                <li key={b.captureId}>
                  <span>
                    {b.buyerEmail ?? "Buyer"}, {b.item}
                  </span>
                  <span className="tabular muted">
                    {usd(b.amountCents)}, {day(b.paidAt)}
                    {b.refundable ? ", refund to original payment" : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="tech">{pp.note}</p>
            {pp.buyers.length > 0 && !pp.imported && (
              <p style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-quiet" onClick={() => void searchPayPal(true)} disabled={busy !== "idle"}>
                  Save these buyers as sales
                </button>
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

/** Save the notices as a CSV file, built here from the firm's own file and the links Remedy made. */
function download(rows: NoticeRow[], recall: string, today: string) {
  const url = URL.createObjectURL(new Blob([noticeCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = noticeFileName(recall, today);
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The first notice as the buyer will read it: plain text, real headings and a real link, nothing hidden. */
function EmailPreview({ row, firmName, paragraphs }: { row: NoticeRow; firmName: string; paragraphs: string[] }) {
  return (
    <article className="by-email" aria-labelledby="by-email-h" data-testid="notice-preview">
      <h3 id="by-email-h" className="by-email-h">
        The {row.channel === "sms" ? "text message" : "email"} the first buyer gets
      </h3>
      <dl className="by-email-head">
        <div>
          <dt>From</dt>
          <dd>The {firmName} recall team, sent from your own mail tool</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{row.contact}</dd>
        </div>
        {row.channel === "email" && (
          <div>
            <dt>Subject</dt>
            <dd>{row.subject}</dd>
          </div>
        )}
      </dl>
      <div className="by-email-body">
        {paragraphs.map((p) => {
          const at = p.indexOf(row.link);
          return (
            <p key={p}>
              {at < 0 ? (
                p
              ) : (
                <>
                  {p.slice(0, at)}
                  <a className="text-link by-link" href={row.link}>
                    {row.link}
                  </a>
                  {p.slice(at + row.link.length)}
                </>
              )}
            </p>
          );
        })}
      </div>
    </article>
  );
}
