"use client";

import { useEffect } from "react";

/** Opens every closed `<details>` that contains `el` (and `el` itself, if it is one), so it can be seen. */
export function openAround(el: Element) {
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
}

/**
 * Opens every closed `<details>` around the element a hash names and, unless told not to, scrolls to it.
 * Returns false when no element has that id.
 */
export function openToHash(hash: string = location.hash, scroll = true): boolean {
  let id = hash.replace(/^#/, "");
  if (!id) return false;
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape: look the raw id up instead.
  }
  const target = document.getElementById(id);
  if (!target) return false;
  openAround(target);
  // Honours CSS scroll-behavior and scroll-margin-top, so sticky bars never cover the target.
  if (scroll) target.scrollIntoView({ block: "start" });
  return true;
}

/**
 * Keeps in-page links working when their target sits inside a collapsed `<details>`. Render it once per page.
 * - On load and on `hashchange`, it opens the disclosures around the target and scrolls to it.
 * - On a click on a link to this page with a hash, it opens them first, so the browser's (or the router's) own scroll
 *   lands on a visible element. This also covers Next `<Link>` hash links and links to the hash already in the URL,
 *   which fire no `hashchange`.
 */
export function OpenOnHash() {
  useEffect(() => {
    // One frame after mount, so this lands after the router's own scroll on a client navigation.
    const raf = requestAnimationFrame(() => openToHash());
    const onHash = () => openToHash();
    const onPop = () => openToHash(location.hash, false);
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
      openToHash(url.hash, false);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
