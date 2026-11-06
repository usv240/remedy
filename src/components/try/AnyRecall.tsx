"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { PublicRecall } from "@/app/api/claims/_lib/recall";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { RecallCard } from "@/components/claim/RecallCard";
import { RuleView } from "./RuleView";

type Found = { found: true; from: "list" | "cpsc_live"; recall: PublicRecall; in_remedy: boolean; claim_url: string | null };

/** "Any recall": paste a CPSC recall number or recall page address; see its proof rule and download it. */
export function AnyRecall() {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const hint = useId();
  const out = useRef<HTMLDivElement>(null);

  async function look(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) {
      setMsg("Paste a CPSC recall number, such as 27056, or a recall page address.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/try/recall?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json();
      if (!r.ok) {
        setFound(null);
        setMsg(j.error?.message ?? "That recall could not be found.");
      } else {
        setFound(j.data as Found);
        requestAnimationFrame(() => out.current?.focus());
      }
    } catch {
      setMsg("The lookup did not answer just now. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="tr-any">
      <p className="tr-intro">
        Paste any CPSC recall and see the checklist and checks Remedy would use. <ClaimInfo k="try.anyrecall" topic="any recall" />
      </p>
      <form className="fr-form" onSubmit={look} data-ui>
        <label htmlFor={id} className="fr-label">
          Recall number or cpsc.gov address
        </label>
        <div className="fr-row">
          <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="27056" autoComplete="off" aria-describedby={hint} inputMode="text" />
          <button type="submit" className="btn btn-quiet" disabled={busy}>
            {busy ? "Looking" : "Look it up"}
          </button>
        </div>
        <p id={hint} className="cl-hint">
          For example 27045, the pajama set recall of Oct 29, 2026, or 26754, a hair dryer brush recall.
        </p>
      </form>
      {msg && (
        <p className="cl-error" role="alert">
          {msg}
        </p>
      )}
      {found && (
        <div ref={out} tabIndex={-1} className="tr-any-out app-sheet">
          <RecallCard recall={found.recall} />
          <RuleView recall={found.recall} />
          <div className="tr-preset-actions">
            <a className="btn btn-quiet" href={`/api/try/recall?q=${found.recall.number}&download=1`} download>
              Download as JSON
            </a>
            {found.claim_url && found.recall.rule.photo_required && (
              <Link className="btn btn-ink" href={found.claim_url}>
                Start a claim
              </Link>
            )}
          </div>
          <p className="cl-hint">{found.from === "list" ? "From Remedy's list of every CPSC recall since January 2024." : "Fetched live from the CPSC Recalls API; this recall is not in Remedy's list, so its rule is a quick read."}</p>
        </div>
      )}
    </div>
  );
}
