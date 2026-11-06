"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type TabId = "examples" | "your-photo" | "any-recall";
const TABS: { id: TabId; label: string }[] = [
  { id: "examples", label: "Examples" },
  { id: "your-photo", label: "Your photo" },
  { id: "any-recall", label: "Any recall" },
];

/**
 * Three tabs, kept in the address (#examples, #your-photo, #any-recall) so a link opens the right one. Arrow keys,
 * Home and End move between tabs (the ARIA tabs pattern); every panel stays mounted, so work in one is kept.
 */
export function TryTabs({ panels }: { panels: Record<TabId, ReactNode> }) {
  const [tab, setTab] = useState<TabId>("examples");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as TabId;
      // The address is only readable on the client, after the first render.
      if (TABS.some((t) => t.id === h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  function select(id: TabId, focus = false) {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
    if (focus) refs.current[id]?.focus();
  }

  function onKey(e: React.KeyboardEvent, i: number) {
    const n = TABS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(TABS[to].id, true);
  }

  return (
    <div className="tr-tabs">
      <div role="tablist" aria-label="Ways to try Remedy" className="tr-tablist" data-ui>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="tr-tab"
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id} className="tr-panel" tabIndex={0}>
          {panels[t.id]}
        </div>
      ))}
    </div>
  );
}
