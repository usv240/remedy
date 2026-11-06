"use client";

import { useState } from "react";
import type { Narrative } from "@/lib/firm/narrative";
import { FirmInfo } from "./FirmInfo";

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The summary paragraph, with the one model call a person can ask for, and the print and CSV actions. */
export function ReportNarrative({ month, recall, initial }: { month: string; recall: string; initial: Narrative }) {
  const [n, setN] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(initial.note);

  async function write() {
    setBusy(true);
    setNote("Writing the summary from these numbers…");
    try {
      const r = await fetch("/api/firm/reports/narrative", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month, recall }) });
      const j = (await r.json()) as { data: Narrative | null; error: { message: string } | null };
      if (j.data) {
        setN(j.data);
        setNote(j.data.note);
      } else setNote(j.error?.message ?? "The summary could not be written just now.");
    } catch {
      setNote("The summary could not be written just now. The plain template is shown.");
    } finally {
      setBusy(false);
    }
  }

  const byClaude = n.source === "claude";
  return (
    <section className="firm-section" aria-labelledby="rp-sum">
      <h2 id="rp-sum">
        Summary <FirmInfo id="firm.narrative" label="" />
      </h2>
      <p className="rp-narrative" data-testid="report-narrative">
        {n.text}
      </p>
      <p className="firm-status muted" style={{ marginTop: 8 }} aria-live="polite">
        {byClaude ? `Written by Claude Haiku 5.5 from the numbers below${n.writtenAt ? `, ${WHEN.format(new Date(n.writtenAt))}` : ""}.` : "Plain template, filled from the numbers below."}
        {n.stale ? " The numbers have changed since it was written." : ""} {note ?? ""}
      </p>
      <p className="tech">{byClaude ? `Model ${n.model}, effort low. Every figure in the paragraph was checked against the report.` : "No model call."}</p>
      {(!byClaude || n.stale) && (
        <p className="no-print" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-quiet" onClick={() => void write()} disabled={busy}>
            {busy ? "Writing…" : byClaude ? "Write it again from the new numbers" : "Write the summary with Claude"}
          </button>
        </p>
      )}
    </section>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn btn-ink" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
