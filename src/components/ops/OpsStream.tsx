"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { FeedItem } from "@/lib/ops/data";

const REDUCE = "(prefers-reduced-motion: reduce)";
const watchReduce = (cb: () => void) => {
  const m = window.matchMedia(REDUCE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

function Row({ item }: { item: FeedItem }) {
  if (item.kind === "request") {
    return (
      <li className="ops-ev" data-kind="request" data-status={item.status >= 500 ? "error" : item.status >= 400 ? "client" : "ok"}>
        <time className="ops-ev-time tabular" dateTime={item.at}>
          {fmtTime(item.at)}
        </time>
        <span className="ops-ev-what">
          <span className="ops-ev-tag">request</span> {item.route}
        </span>
        <span className="ops-ev-meta tabular">
          {item.status} in {item.ms} ms <span className="ops-tech">{item.requestId}</span>
        </span>
      </li>
    );
  }
  return (
    <li className="ops-ev" data-kind="ledger">
      <time className="ops-ev-time tabular" dateTime={item.at}>
        {fmtTime(item.at)}
      </time>
      <span className="ops-ev-what">
        <span className="ops-ev-tag">ledger</span> {item.action}
      </span>
      <span className="ops-ev-meta tabular">
        {item.actor} <span className="ops-tech">{item.ref}</span>
      </span>
    </li>
  );
}

/**
 * The live feed: the newest 50 ledger entries and API requests, over Server-Sent Events every 2 s. Readers who asked
 * for reduced motion get a Refresh button instead of a moving list.
 */
export function OpsStream({ initial }: { initial: FeedItem[] }) {
  const reduce = useSyncExternalStore(watchReduce, () => window.matchMedia(REDUCE).matches, () => false);
  const [items, setItems] = useState<FeedItem[]>(initial);
  const [live, setState] = useState<"idle" | "live" | "paused">("idle");
  const [at, setAt] = useState<string | null>(null);
  // Reduced motion wins: no moving list, a Refresh button instead.
  const state = reduce ? "off" : live;

  const merge = useCallback((fresh: FeedItem[]) => {
    setItems((old) => {
      const seen = new Set(old.map((i) => `${i.kind}:${i.id}`));
      const add = fresh.filter((i) => !seen.has(`${i.kind}:${i.id}`));
      return [...add, ...old].sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1)).slice(0, 50);
    });
  }, []);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/ops/live?once=1").catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as { items: FeedItem[]; at: string } | null) : null;
    if (j) {
      merge(j.items);
      setAt(j.at);
    }
  }, [merge]);

  useEffect(() => {
    if (reduce) return;
    let es: EventSource | null = null;
    const open = () => {
      es = new EventSource("/api/ops/live");
      es.addEventListener("items", (e) => {
        const j = JSON.parse((e as MessageEvent).data) as { items: FeedItem[]; at: string };
        merge(j.items);
        setAt(j.at);
        setState("live");
      });
      es.onerror = () => setState("paused");
    };
    open();
    const onVis = () => {
      if (document.hidden) {
        es?.close();
        setState("paused");
      } else if (!es || es.readyState === EventSource.CLOSED) open();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      es?.close();
    };
  }, [reduce, merge]);

  return (
    <div className="ops-stream">
      <p className="ops-stream-state" role="status">
        {state === "live" && (
          <>
            <span className="ops-dot" aria-hidden="true" /> Live, updated {at ? fmtTime(at) : "just now"}.
          </>
        )}
        {state === "paused" && "Paused; reconnecting."}
        {state === "idle" && "Connecting to the live feed."}
        {state === "off" && (
          <>
            Reduced motion is on, so this list does not move on its own.{" "}
            <button type="button" className="btn btn-quiet ops-refresh" onClick={() => void refresh()}>
              Refresh
            </button>
            {at && <span className="muted"> Updated {fmtTime(at)}.</span>}
          </>
        )}
      </p>
      <ol className="ops-events" aria-label="Newest events" aria-live="off">
        {items.map((i) => (
          <Row key={`${i.kind}:${i.id}`} item={i} />
        ))}
        {!items.length && <li className="muted">No events yet. Open a recall or run a photo check and they appear here.</li>}
      </ol>
    </div>
  );
}
