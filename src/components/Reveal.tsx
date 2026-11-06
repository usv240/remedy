"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Staggered section entrances. Nothing is hidden in CSS: each element is animated with the Web Animations API
 * only at the moment it scrolls into view, so screen readers, scanners and no-JS readers always see full content.
 */
export function Reveal() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io.unobserve(el);
          const i = Number(el.style.getPropertyValue("--reveal-i") || 0);
          el.animate(
            [
              { opacity: 0, transform: "translateY(20px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 600, delay: i * 70, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "backwards" },
          );
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of els) {
      // Elements already on screen at load are left alone, so the first view never flickers.
      if (el.getBoundingClientRect().top < window.innerHeight) continue;
      io.observe(el);
    }
    return () => io.disconnect();
  }, [pathname]);
  return null;
}
