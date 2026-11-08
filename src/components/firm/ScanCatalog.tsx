"use client";

import { useId, useRef, useState } from "react";
import type { ScanReport, ScanRow, ScanStatus } from "@/lib/recall/scan";
import { parseCatalogCsv } from "@/lib/recall/scan-csv";
import { FirmInfo } from "./FirmInfo";

type Report = Pick<ScanReport, "summary" | "ai"> & { results: ScanRow[] };
type Filter = ScanStatus | "all";

const LABEL: Record<ScanStatus, string> = { photo_refund: "Photo refund", recalled: "Recalled", clear: "Clear", unknown: "Unknown" };
const TONE: Record<ScanStatus, "positive" | "attention" | "neutral" | "info"> = { photo_refund: "positive", recalled: "attention", clear: "neutral", unknown: "info" };
const BY: Record<string, string> = { model: "model number", upc: "UPC", keywords: "keywords", claude: "Claude" };

const SAMPLE_TEXT = `name,model,sku,brand
HAIARA 10000mAh power bank,,,HAIARA
Wantefully hair dryer brush,,,Wantefully
QZH.DUAO children's pajamas,,,
Bamboo cutting board 18 by 12 inch,,GK-CB-1812,Greenfield Kitchen
Stoneware coffee mug 12 oz,,HP-MUG-12,Harbor Pottery`;

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (iso: string) => DAY.format(new Date(`${iso}T12:00:00Z`));

/** Paste or upload a catalog CSV, send it to POST /api/v1/scan, and read the rows back as a table with a CSV download. */
export function ScanCatalog({ freeItems, maxItems }: { freeItems: number; maxItems: number }) {
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone?: "attention" | "positive" } | null>(null);
  const areaId = useId();

  async function loadSample() {
    setStatus({ text: "Loading the sample catalog…" });
    try {
      const r = await fetch("/api/v1/scan/sample");
      const j = (await r.json()) as { data: { items: { name: string; model?: string; sku?: string; brand?: string }[] } | null };
      const items = j.data?.items ?? [];
      const esc = (v: string | undefined) => (v && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : (v ?? ""));
      setText(["name,model,sku,brand", ...items.map((i) => [i.name, i.model, i.sku, i.brand].map(esc).join(","))].join("\n"));
      setStatus({ text: `${items.length} sample rows loaded: real recalls from Remedy's data and three everyday items.`, tone: "positive" });
    } catch {
      setText(SAMPLE_TEXT);
      setStatus({ text: "The sample could not be fetched, so a short one is filled in." });
    }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setText(await f.text());
    setStatus({ text: `${f.name} loaded. Press Scan to check it.` });
  }

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseCatalogCsv(text, maxItems);
    if (!parsed.items.length) return setStatus({ text: parsed.warnings[0] ?? "Paste a few product lines first, or upload a CSV.", tone: "attention" });
    setBusy(true);
    setReport(null);
    setStatus({ text: `Checking ${parsed.items.length} ${parsed.items.length === 1 ? "row" : "rows"} against every recall since 2024…` });
    try {
      const r = await fetch("/api/v1/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: parsed.items }) });
      const j = (await r.json()) as { data: Report | null; error: { message: string } | null };
      if (!j.data) return setStatus({ text: j.error?.message ?? "The scan did not finish. Please try again.", tone: "attention" });
      setReport(j.data);
      setFilter("all");
      const s = j.data.summary;
      setStatus({ text: `${s.total} rows: ${s.photo_refund} pay a refund for a photo, ${s.recalled} recalled with another remedy, ${s.clear} clear, ${s.unknown} unknown.${parsed.warnings.length ? ` ${parsed.warnings.join(" ")}` : ""}`, tone: "positive" });
    } catch {
      setStatus({ text: "The scan did not finish. Please try again.", tone: "attention" });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!report) return;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["row", "name", "model", "sku", "brand", "status", "confidence", "matched_by", "recall_number", "recall_title", "recall_date", "remedy", "refund_amount", "claim_url", "cpsc_url", "reason"];
    const lines = report.results.map((r) => [r.row, r.item.name, r.item.model, r.item.sku, r.item.brand, r.status, r.confidence, r.matched_by, r.recall?.number, r.recall?.title, r.recall?.date, r.recall?.remedy_summary, r.recall?.refund_amount, r.claim_url, r.recall?.cpsc_url, r.reason].map(esc).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "remedy-scan.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const rows = report ? report.results.filter((r) => filter === "all" || r.status === filter) : [];
  const counts: { id: Filter; label: string; n: number }[] = report
    ? [
        { id: "all", label: "All rows", n: report.summary.total },
        { id: "photo_refund", label: "Photo refund", n: report.summary.photo_refund },
        { id: "recalled", label: "Recalled", n: report.summary.recalled },
        { id: "clear", label: "Clear", n: report.summary.clear },
        { id: "unknown", label: "Unknown", n: report.summary.unknown },
      ]
    : [];

  return (
    <>
      <section className="firm-section" aria-labelledby="sc-in">
        <h2 id="sc-in">Your catalog</h2>
        <p className="muted">
          One product per line, as a CSV with name, model, sku and brand columns, or just the names. Up to {freeItems} rows here; the API takes {maxItems} with a key.
        </p>
        <form className="sc-form" onSubmit={(e) => void scan(e)}>
          <label className="firm-field sc-area" htmlFor={areaId}>
            Catalog CSV
            <textarea id={areaId} className="firm-input" value={text} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} placeholder={SAMPLE_TEXT} data-testid="scan-text" />
          </label>
          <div className="by-drop">
            <button type="submit" className="btn btn-ink" disabled={busy}>
              {busy ? "Scanning…" : "Scan"}
            </button>
            <label className="firm-field sc-file">
              Or upload a CSV
              <input ref={file} type="file" accept=".csv,text/csv" className="firm-input" onChange={(e) => void pickFile(e.target.files?.[0])} data-testid="scan-file" />
            </label>
            <button type="button" className="firm-link sc-sample" onClick={() => void loadSample()} disabled={busy}>
              Load the sample catalog
            </button>
          </div>
        </form>
      </section>

      <p className="firm-status" role="status" data-tone={status?.tone} style={{ marginTop: 12 }}>
        {status?.text ?? ""}
      </p>

      {report && (
        <section className="firm-section" aria-labelledby="sc-res">
          <h2 id="sc-res">
            Results <FirmInfo id="firm.scan" topic="how each row is decided" label="" />
          </h2>
          <div className="sc-counts" role="group" aria-label="Show rows by result">
            {counts.map((c) => (
              <button key={c.id} type="button" className="sc-count" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
                <span className="sc-count-k">{c.label}</span>
                <span className="sc-count-v tabular">{c.n}</span>
              </button>
            ))}
          </div>
          <p className="muted sc-ai">{report.ai.note}</p>
          <div className="by-table-wrap" role="region" aria-label="Catalog scan results" tabIndex={0}>
            <table className="by-table sc-table">
              <thead>
                <tr>
                  <th scope="col" className="num">
                    Row
                  </th>
                  <th scope="col">Product</th>
                  <th scope="col">Result</th>
                  <th scope="col">Recall</th>
                  <th scope="col">Remedy</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row}>
                    <td className="num">{r.row}</td>
                    <td>
                      {r.item.name}
                      {r.item.brand || r.item.model || r.item.sku ? <span className="muted"> ({[r.item.brand, r.item.model, r.item.sku].filter(Boolean).join(", ")})</span> : null}
                    </td>
                    <td>
                      <span className="pill" data-tone={TONE[r.status]}>
                        {LABEL[r.status]}
                      </span>
                      {r.matched_by ? <span className="muted sc-by"> by {BY[r.matched_by] ?? r.matched_by}</span> : null}
                    </td>
                    <td>
                      {r.recall ? (
                        <>
                          <a className="firm-link sc-link" href={r.recall.page} target="_blank" rel="noreferrer">
                            {r.recall.number}
                          </a>
                          <span className="muted"> {day(r.recall.date)}</span>
                        </>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                    <td>
                      {r.recall ? r.recall.remedy_summary : <span className="muted">No recall</span>}
                      {r.claim_url ? (
                        <>
                          {" "}
                          <a className="firm-link sc-link" href={r.claim_url} target="_blank" rel="noreferrer">
                            Claim link
                          </a>
                        </>
                      ) : null}
                    </td>
                    <td className="sc-why">{r.reason}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No rows with this result.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="by-drop">
            <button type="button" className="btn btn-quiet" onClick={download}>
              Download the results (CSV)
            </button>
          </div>
        </section>
      )}
    </>
  );
}
