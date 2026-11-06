"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { day } from "./format";

export type RecallPick = { number: string; product: string; title: string; date: string; image: string | null; photo_refund: boolean };
/** A hit from another agency (FDA or NHTSA), shown labelled with a link to the agency's page. */
export type AgencyPick = { agency: "FDA" | "NHTSA"; agency_name: string; ref: string; title: string; hazard: string; remedy: string | null; date: string; url: string; note: string };
type AgencyTier = { checked: boolean; hits: AgencyPick[]; note: string };

/**
 * "Find your recall": search by what the product is ("power bank", "hair dryer"). Results link to the claim page, or,
 * with `onPick`, choose the recall in place (the Try page's "Your photo").
 */
export function FindRecall({ onPick, picks = [], label = "What is the product?" }: { onPick?: (r: RecallPick) => void; picks?: RecallPick[]; label?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RecallPick[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [mode, setMode] = useState<string | null>(null);
  const [agencies, setAgencies] = useState<AgencyTier | null>(null);
  const [elsewhere, setElsewhere] = useState<RecallPick[]>([]);
  const id = useId();
  const hintId = useId();
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef("");

  async function search(query: string) {
    const term = query.trim();
    latest.current = term;
    if (term.length < 2) {
      setHits(null);
      setAgencies(null);
      setElsewhere([]);
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const number = /(?:^|\D)(\d{4,6})(?:\D|$)/.exec(term)?.[1];
      if (number) {
        const r = await fetch(`/api/try/recall?q=${number}`);
        const j = await r.json();
        if (latest.current !== term) return;
        const rc = j.data?.found && j.data.in_remedy ? j.data.recall : null;
        setHits(rc ? [{ number: rc.number, product: rc.product, title: rc.title, date: rc.date, image: rc.images[0]?.src?.startsWith("/") ? rc.images[0].src : null, photo_refund: rc.photoRefund }] : []);
        setAgencies(null);
        setElsewhere([]);
        setState("idle");
        return;
      }
      const r = await fetch(`/api/try/recalls?photo=1&q=${encodeURIComponent(term)}`);
      const j = await r.json();
      if (latest.current !== term) return;
      if (!r.ok) throw new Error(j.error?.message);
      setHits(j.data.hits.map((h: { number: string; product: string; title: string; date: string; image: string | null; photo_refund: boolean }) => h));
      setMode(j.data.mode);
      setElsewhere(Array.isArray(j.data.cpsc_elsewhere) ? j.data.cpsc_elsewhere.map((h: RecallPick) => ({ ...h, image: null, photo_refund: false })) : []);
      setAgencies(null);
      setState("idle");
      // Second tier: only when the CPSC search did not find the product, so the first results never wait on another agency.
      if (j.data.cpsc_good === false && term.length >= 3) {
        setAgencies({ checked: false, hits: [], note: "Checking the FDA and NHTSA too..." });
        const a = await fetch(`/api/try/agencies?q=${encodeURIComponent(term)}`);
        const aj = await a.json().catch(() => null);
        if (latest.current !== term) return;
        setAgencies(aj?.data?.checked ? aj.data : null);
      }
    } catch {
      if (latest.current === term) setState("error");
    }
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const row = (h: RecallPick) => (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- local CPSC thumbnails */}
      {h.image ? <img src={h.image} alt="" width={56} height={56} loading="lazy" /> : <span className="fr-noimg" aria-hidden="true" />}
      <span className="fr-text">
        <span className="fr-product">{h.product}</span>
        <span className="fr-meta tabular">
          Recall {h.number}, {day(h.date)}
        </span>
      </span>
    </>
  );
  const list = hits ?? (q.trim().length < 2 ? picks : []);

  return (
    <div className="fr" data-ui>
      <form
        className="fr-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <label htmlFor={id} className="fr-label">
          {label}
        </label>
        <div className="fr-row">
          <input
            id={id}
            type="search"
            value={q}
            autoComplete="off"
            aria-describedby={hintId}
            placeholder="power bank, hair dryer, pajamas"
            onChange={(e) => {
              setQ(e.target.value);
              window.clearTimeout(timer.current);
              const v = e.target.value;
              timer.current = window.setTimeout(() => void search(v), 280);
            }}
          />
          <button type="submit" className="btn btn-quiet">
            Search
          </button>
        </div>
        <p id={hintId} className="cl-hint">
          Only recalls that refund for a photo are shown. You can also paste the recall number.
        </p>
      </form>
      <div aria-live="polite" className="fr-status">
        {state === "loading" && <span className="sr-only">Searching</span>}
        {state === "error" && <p className="cl-note">Search did not answer just now. Please try again.</p>}
        {hits && hits.length === 0 && state === "idle" && elsewhere.length === 0 && <p className="cl-note">No photo-refund recall matches that yet. Try another word for the product.</p>}
        {hits && hits.length === 0 && state === "idle" && elsewhere.length > 0 && (
          <p className="cl-note">
            No photo-refund recall matches that, but the CPSC has one with another remedy:{" "}
            {elsewhere.map((h, i) => (
              <span key={h.number}>
                {i > 0 ? ", " : ""}
                <Link className="text-link" href={`/recalls/${h.number}`}>
                  {h.product} (recall {h.number})
                </Link>
              </span>
            ))}
            .
          </p>
        )}
        {hits && hits.length > 0 && <span className="sr-only">{hits.length} recalls found</span>}
      </div>
      {list.length > 0 && (
        <ul className="fr-list" aria-busy={state === "loading" || undefined}>
          {list.map((h) => (
            <li key={h.number}>
              {onPick ? (
                <button type="button" className="fr-hit" onClick={() => onPick(h)}>
                  {row(h)}
                </button>
              ) : (
                <Link className="fr-hit" href={`/claim/${h.number}`}>
                  {row(h)}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {agencies && agencies.hits.length > 0 && (
        <section className="fr-agencies" aria-labelledby={`${id}-ag`}>
          <h3 id={`${id}-ag`} className="fr-ag-title">
            Found at another agency
          </h3>
          <p className="cl-hint">{agencies.note}</p>
          <ul className="fr-list">
            {agencies.hits.map((h) => (
              <li key={h.ref} className="fr-ag">
                <span className="fr-ag-pill" data-agency={h.agency}>
                  {h.agency}
                </span>
                <span className="fr-text">
                  <span className="fr-product">{h.title}</span>
                  {h.hazard && <span className="fr-meta">{h.hazard}</span>}
                  <span className="fr-meta tabular">
                    {h.date ? `${day(h.date)}. ` : ""}
                    <a className="text-link" href={h.url} target="_blank" rel="noreferrer">
                      See it at the {h.agency}
                    </a>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {agencies && agencies.hits.length === 0 && state === "idle" && <p className="cl-hint">{agencies.note}</p>}
      {mode && <p className="cl-tech cl-hint">Search: {mode === "elastic" ? "Elastic hybrid search (keyword and semantic, reranked)" : "in-app BM25 over the recall list"}{agencies?.checked ? "; FDA and NHTSA asked as the second tier" : ""}.</p>}
    </div>
  );
}
