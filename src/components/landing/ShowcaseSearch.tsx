"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ApiHit } from "@/lib/api/recall-data";
import { fmtDate, fmtUnits, shortTitle } from "@/lib/api/format";
import { ruleChips } from "@/lib/api/rule-chips";

const EXAMPLES = ["pajama set", "nursing pillow", "space heater"];

type State = { query: string; hits: ApiHit[]; mode: string | null; status: "idle" | "loading" | "error" };

/**
 * "Headline you can type": the section's headline is a real input. As the visitor types, the top three recalls from
 * GET /api/v1/recalls appear under it with their proof rules as chips. The first answer is rendered on the server.
 */
export function ShowcaseSearch({ initialQuery, initialHits, initialMode }: { initialQuery: string; initialHits: ApiHit[]; initialMode: string | null }) {
  const [text, setText] = useState(initialQuery);
  const [s, setS] = useState<State>({ query: initialQuery, hits: initialHits, mode: initialMode, status: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  /** The query whose answer is on screen (or on its way), so typing the same words again sends nothing. */
  const asked = useRef(initialQuery);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || q === asked.current) return;
    const n = ++seq.current;
    const t = window.setTimeout(async () => {
      asked.current = q;
      setS((p) => ({ ...p, status: "loading" }));
      try {
        const r = await fetch(`/api/v1/recalls?query=${encodeURIComponent(q)}&limit=3`);
        const j = await r.json();
        if (n !== seq.current) return;
        if (!r.ok) throw new Error(j?.error?.message ?? "Search did not answer");
        setS({ query: q, hits: j.data.hits, mode: j.meta?.search?.mode ?? null, status: "idle" });
      } catch {
        if (n !== seq.current) return;
        asked.current = "";
        setS((p) => ({ ...p, status: "error" }));
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [text]);

  const fill = (q: string) => {
    setText(q);
    input.current?.focus({ preventScroll: true });
  };

  return (
    <div className="sc">
      <div className="sc-line" data-ui>
        <label htmlFor="sc-input" className="sr-only">
          Search every recall since 2024. Type what you bought.
        </label>
        <input
          ref={input}
          id="sc-input"
          className="sc-input"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={80}
          aria-describedby="sc-hint"
          aria-controls="sc-results"
        />
      </div>
      <p id="sc-hint" className="sc-hint">
        Type what you bought. Every recall since 2024, read as a checklist.
      </p>

      <div id="sc-results" className="sc-results" data-ui data-busy={s.status === "loading" ? "" : undefined} aria-live="polite" aria-busy={s.status === "loading"}>
        {s.status === "error" ? (
          <p className="sc-empty">Search did not answer just now. Please try again in a moment.</p>
        ) : s.hits.length === 0 ? (
          <p className="sc-empty">
            No recall since 2024 matches &ldquo;{s.query}&rdquo;. Try the kind of product, or its brand.
          </p>
        ) : (
          <ol className="sc-rows">
            {s.hits.map((h) => {
              const chips = ruleChips(h.proof_rule);
              return (
                <li key={h.number}>
                  <Link className="sc-row" href={h.page}>
                    <span className="sc-thumb" aria-hidden="true">
                      {h.image?.thumb ? <img src={h.image.thumb} alt="" width={56} height={56} loading="lazy" /> : null}
                    </span>
                    <span className="sc-main">
                      <span className="sc-title">{shortTitle(h.title)}</span>
                      <span className="sc-meta tabular">
                        Recall {h.number} · {fmtDate(h.date)} · {fmtUnits(h.units)}
                      </span>
                      <span className="sc-chips">
                        {h.photo_refund ? (
                          chips.map((c) => (
                            <span key={c} className="chip">
                              {c}
                            </span>
                          ))
                        ) : (
                          <span className="chip" data-quiet="">
                            No photo needed: {h.remedies.join(", ").toLowerCase() || "see the recall"}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        <p className="sc-foot">
          <Link className="text-link" href={`/recalls?query=${encodeURIComponent(s.query)}`}>
            All results for &ldquo;{s.query}&rdquo;
          </Link>
          {s.mode && <span className="sc-mode lp-tech">Search: {s.mode === "elastic" ? "Elastic hybrid, reranked" : "in-app keyword ranking"}</span>}
        </p>
      </div>

      <div className="sc-examples" role="group" aria-label="Examples">
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="sc-example" onClick={() => fill(q)} aria-pressed={text === q}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
