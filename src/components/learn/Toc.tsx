"use client";

import { useEffect, useRef } from "react";
import { TocSpy } from "./TocSpy";

export type TocItem = { id: string; title: string };

function TocList({ items, onPick }: { items: TocItem[]; onPick?: () => void }) {
  return (
    <ul>
      {items.map((t) => (
        <li key={t.id}>
          <a href={`#${t.id}`} onClick={onPick}>
            {t.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Contents for a long read page: a sticky list beside the text on wide screens, and on phones a Contents menu that stays
 * at the top of the screen and closes once a section is chosen. Styles are in src/app/learn/toc.css.
 */
export function Toc({ items, className = "" }: { items: TocItem[]; className?: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (menu.current) menu.current.open = false;
  };
  // A tap anywhere else on the page closes the open menu, the way a menu does.
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <>
      <nav className={`toc ${className}`.trim()} aria-label="On this page">
        <p className="toc-k">On this page</p>
        <TocList items={items} />
      </nav>
      <details
        ref={menu}
        className="toc-m"
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !menu.current?.open) return;
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }}
      >
        <summary>Contents</summary>
        <nav aria-label="Contents">
          <TocList items={items} onPick={close} />
        </nav>
      </details>
      <TocSpy nav=".toc, .toc-m" />
    </>
  );
}
