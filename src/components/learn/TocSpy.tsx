"use client";

import { useEffect } from "react";

/**
 * Marks the contents link of the section being read with aria-current, so the sticky list shows where you are. The links
 * work without it; this only adds the marker. `nav` is a selector, or several separated by commas (the wide-screen list
 * and the phone menu each hold a link to the same section).
 */
export function TocSpy({ nav }: { nav: string }) {
  useEffect(() => {
    const selector = nav
      .split(",")
      .map((s) => `${s.trim()} a[href^="#"]`)
      .join(", ");
    const byId = new Map<string, HTMLAnchorElement[]>();
    for (const a of document.querySelectorAll<HTMLAnchorElement>(selector)) {
      const id = decodeURIComponent(a.hash.slice(1));
      byId.set(id, [...(byId.get(id) ?? []), a]);
    }
    const sections = [...byId.keys()].map((id) => document.getElementById(id)).filter((s): s is HTMLElement => Boolean(s));
    if (!sections.length) return;
    const visible = new Set<string>();
    const mark = () => {
      // The first section on screen, in page order; past the last one, keep the last.
      const id = sections.find((s) => visible.has(s.id))?.id;
      if (!id) return;
      for (const [k, links] of byId) {
        for (const a of links) {
          if (k === id) a.setAttribute("aria-current", "location");
          else a.removeAttribute("aria-current");
        }
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        mark();
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const s of sections) io.observe(s);
    return () => io.disconnect();
  }, [nav]);
  return null;
}
