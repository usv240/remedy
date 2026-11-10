"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { ReadField } from "@/lib/label/reading";
import { LABEL_CREDITS, LABEL_SAMPLES, type LabelSample } from "@/lib/label/samples";
import type { LabelCheck, LabelMatch } from "@/lib/label/types";
import { ClaimInfo } from "./ClaimInfo";
import { day, money } from "./format";

/** The event FindRecall listens for, to search by the name read from a label. */
export const SEARCH_EVENT = "remedy:search";

const ACCEPT = "image/jpeg,image/png,image/webp";

type State =
  | { kind: "idle" }
  | { kind: "reading"; preview: string; sample: LabelSample | null }
  | { kind: "done"; preview: string; sample: LabelSample | null; check: LabelCheck }
  | { kind: "error"; preview: string | null; message: string };

/**
 * "Is it recalled? Snap the label": the owner photographs the product's label, Claude reads it, and code finds the
 * recall (POST /api/v1/label). A match leads straight into that recall's claim. Phone first: the camera opens on a
 * phone; a computer chooses a file. Three sample labels replay a recorded reading, so it works with no key.
 */
export function LabelScan() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const resultRef = useRef<HTMLDivElement>(null);
  const objectUrl = useRef<string | null>(null);
  const seq = useRef(0);
  const tipId = useId();

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  async function send(body: FormData | string, preview: string, sample: LabelSample | null) {
    const n = ++seq.current;
    setState({ kind: "reading", preview, sample });
    try {
      const res = await fetch("/api/v1/label", typeof body === "string" ? { method: "POST", headers: { "Content-Type": "application/json" }, body } : { method: "POST", body });
      const j = (await res.json().catch(() => null)) as { data?: LabelCheck; error?: { message?: string } } | null;
      if (n !== seq.current) return;
      if (!res.ok || !j?.data) throw new Error((j?.error?.message ?? "The label could not be checked just now. Please try again, or search by name.").replace(/\s*Request id: \S+$/, ""));
      setState({ kind: "done", preview, sample, check: j.data });
    } catch (e) {
      if (n !== seq.current) return;
      setState({ kind: "error", preview, message: (e as Error).message });
    }
    requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: false }));
  }

  function pick(file: File | undefined) {
    if (!file) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    if (file.size > 10 * 1024 * 1024) {
      setState({ kind: "error", preview: objectUrl.current, message: "That photo is over 10 MB. Please send a smaller copy." });
      return;
    }
    const fd = new FormData();
    fd.set("photo", file);
    void send(fd, objectUrl.current, null);
  }

  /** The chosen file, then the input cleared, so choosing the same photo again reads it again. */
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    pick(e.target.files?.[0]);
    e.target.value = "";
  }

  function trySample(s: LabelSample) {
    void send(JSON.stringify({ sample: s.id }), s.src, s);
  }

  function searchByName(q: string) {
    window.dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: q }));
  }

  const busy = state.kind === "reading";
  const preview = state.kind === "idle" ? null : state.preview;

  return (
    <div className="lb" data-ui>
      <p id={tipId} className="lb-tip">
        Photograph the label with the model number: the sticker underneath, the plate on the back, or the sewn-in tag. Fill the photo with it, in good light.
      </p>
      <div className="lb-pick">
        <label className="btn btn-ink lb-btn lb-take" aria-disabled={busy || undefined}>
          <input className="cl-file" type="file" accept={ACCEPT} capture="environment" aria-describedby={tipId} disabled={busy} onChange={onFile} />
          Take a photo of the label
        </label>
        <label className="btn lb-btn lb-choose" aria-disabled={busy || undefined}>
          <input className="cl-file" type="file" accept={ACCEPT} aria-describedby={tipId} disabled={busy} onChange={onFile} />
          Choose a photo of the label
        </label>
      </div>
      <div className="lb-samples">
        <p className="lb-samples-lead">No label to hand? Try one:</p>
        <ul className="lb-sample-list">
          {LABEL_SAMPLES.map((s) => (
            <li key={s.id}>
              <button type="button" className="lb-sample" onClick={() => trySample(s)} disabled={busy} aria-pressed={state.kind !== "idle" && state.kind !== "error" && state.sample?.id === s.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local sample label, credited below */}
                <img src={s.src} alt="" width={96} height={64} loading="lazy" />
                <span className="lb-sample-name">{s.title}</span>
                <span className="lb-sample-kind">{s.kind}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="lb-credits">{LABEL_CREDITS}</p>
      </div>
      <p className="cl-hint cl-privacy">
        <strong>Your photo:</strong> just the label, with no people in it. It is read once and never kept.
      </p>

      <div className="lb-out" aria-live="polite" aria-busy={busy || undefined}>
        {state.kind !== "idle" && (
          <div className="lb-result" ref={resultRef} tabIndex={-1} data-state={state.kind === "done" ? state.check.outcome : state.kind}>
            {preview && (
              <figure className="lb-shot">
                {/* eslint-disable-next-line @next/next/no-img-element -- the owner's own photo (an object URL) or a sample label */}
                <img src={preview} alt={state.kind !== "error" && state.sample ? state.sample.alt : "Your photo of the label"} />
                {state.kind !== "error" && state.sample && <figcaption>{state.sample.credit}</figcaption>}
              </figure>
            )}
            <div className="lb-answer">
              {state.kind === "reading" && <Reading />}
              {state.kind === "error" && (
                <>
                  <p className="lb-lead">{state.message}</p>
                  <p className="cl-hint">You can try a sample label above, or search by the product&rsquo;s name.</p>
                </>
              )}
              {state.kind === "done" && <Answer check={state.check} onSearch={searchByName} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** While Claude reads: the answer's layout, held by flat bars at the size of what will land there. */
function Reading() {
  return (
    <div className="lb-reading">
      <p className="lb-lead">Reading the label</p>
      <span className="lb-bar" style={{ width: "72%" }} />
      <span className="lb-bar" style={{ width: "54%" }} />
      <span className="lb-bar lb-bar-btn" />
    </div>
  );
}

function Answer({ check, onSearch }: { check: LabelCheck; onSearch: (q: string) => void }) {
  const c = check;
  const searchBtn = (label = "Search by name instead") => (
    <button type="button" className="btn btn-quiet lb-search" onClick={() => onSearch(c.search)}>
      {label}
    </button>
  );
  return (
    <>
      {c.outcome === "match" && <MatchCard m={c.matches[0]} lead />}
      {c.outcome === "candidates" && (
        <>
          <p className="lb-lead">{c.plain}</p>
          <ul className="lb-cands">
            {c.matches.map((m) => (
              <li key={m.number}>
                <MatchCard m={m} />
              </li>
            ))}
          </ul>
        </>
      )}
      {c.outcome === "no_match" && (
        <>
          <p className="lb-lead">{c.plain}</p>
          <p className="cl-hint">That is good news for this product. Recalls are added every week, so a search by name can catch one listed another way.</p>
          {c.search && searchBtn(`Search for ${c.search}`)}
        </>
      )}
      {(c.outcome === "unreadable" || c.outcome === "person") && (
        <>
          <p className="lb-lead">{c.plain}</p>
          <p className="cl-hint">{c.outcome === "person" ? "The photo was not kept, and nothing was read from it." : "Move closer so the label fills the photo, hold the phone still, and avoid glare."}</p>
          {c.search ? searchBtn() : null}
        </>
      )}
      <WhatWeRead check={c} />
    </>
  );
}

function MatchCard({ m, lead = false }: { m: LabelMatch; lead?: boolean }) {
  return (
    <article className="lb-match" data-lead={lead ? "" : undefined}>
      <div className="lb-match-top">
        {m.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- local recall thumbnail
          <img className="lb-match-img" src={m.image} alt="" width={72} height={72} loading="lazy" />
        ) : (
          <span className="lb-match-img lb-noimg" aria-hidden="true" />
        )}
        <div className="lb-match-id">
          <p className="lb-match-product">{m.product}</p>
          <p className="lb-match-meta tabular">
            {m.sample ? "Sample recall" : "CPSC recall"} {m.number}, {day(m.date)}
          </p>
        </div>
      </div>
      <p className={m.matched_by === "keywords" ? "lb-how lb-how-close" : "lb-how"}>{m.how}</p>
      <dl className="lb-facts">
        <div>
          <dt>What the recall asks</dt>
          <dd>{m.remedy_summary}</dd>
        </div>
        {m.photo_refund && (
          <div>
            <dt>Your refund</dt>
            <dd className="tabular">{m.refund_amount ? money(m.refund_amount) : m.refund_amount_text ? sentence(m.refund_amount_text) : "Full refund"}</dd>
          </div>
        )}
      </dl>
      {m.compare && (
        <div className="lb-compare">
          <p className="lb-compare-lead">Check your label against the recall</p>
          <dl>
            <div>
              <dt>The recall says</dt>
              {m.compare.recall_states.map((s) => (
                <dd key={s}>{s}</dd>
              ))}
            </div>
            <div>
              <dt>Your label shows</dt>
              {m.compare.label_shows.map((s) => (
                <dd key={s} className="tabular">
                  {s}
                </dd>
              ))}
            </div>
          </dl>
        </div>
      )}
      <p className="lb-actions">
        {m.claim_url ? (
          <Link className={lead ? "btn btn-primary lb-claim" : "btn btn-ink lb-claim"} href={m.claim_url}>
            {m.matched_by === "keywords" ? "This is mine: start my claim" : "Start my claim"}
          </Link>
        ) : (
          <span className="cl-hint">This recall offers {m.remedy_summary.toLowerCase()}, not a photo refund.</span>
        )}
        <Link className="text-link" href={m.page}>
          See the recall
        </Link>
      </p>
    </article>
  );
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What Claude read, field by field, with what code used and what it set aside. */
function WhatWeRead({ check }: { check: LabelCheck }) {
  const l = check.label;
  const rows: { k: string; f: ReadField }[] = [
    ...(l.brand ? [{ k: "Brand", f: l.brand }] : []),
    ...(l.product ? [{ k: "Product", f: l.product }] : []),
    ...l.models.map((f) => ({ k: "Model", f })),
    ...(l.upc ? [{ k: "UPC", f: l.upc as ReadField }] : []),
    ...l.lots.map((f) => ({ k: f.kind === "date_code" ? "Date code" : f.kind === "manufacture_date" ? "Made" : f.kind === "serial" ? "Serial" : f.kind === "batch" ? "Batch" : "Lot", f })),
  ];
  const src = check.source;
  return (
    <details className="lb-read">
      <summary>What we read from the label</summary>
      {rows.length ? (
        <dl className="lb-read-list">
          {rows.map(({ k, f }, i) => (
            <div key={`${k}-${i}`} data-used={f.used ? "" : undefined}>
              <dt>{k}</dt>
              <dd>
                <span className="tabular">{f.value}</span>
                <span className="lb-read-note">
                  {f.set_aside ?? (f.text_read && f.text_read !== f.value ? `Read as “${f.text_read}”` : "Read as printed")}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cl-hint">Nothing could be read from this photo.</p>
      )}
      <p className="cl-hint">
        {src.kind === "recorded"
          ? `Recorded reading of this sample label by Claude Opus 5.5, ${day(src.recorded_at)}, replayed with no AI call.`
          : `Read just now by Claude Opus 5.5 in ${(src.ms / 1000).toFixed(1)} s.`}{" "}
        Claude reads the label; plain code finds the recall: a model number or UPC in a recall&rsquo;s own list settles it.
      </p>
      <p className="cl-tech cl-hint">{check.technical}</p>
    </details>
  );
}

/** The Info entry for the section heading, shown beside "Is it recalled? Snap the label". */
export function LabelInfo() {
  return <ClaimInfo k="claim.label" topic="snapping the label" />;
}
