"use client";

import { Fragment, useEffect, useState } from "react";

export type Source = { name: string; href: string };

/**
 * "Names as one sentence": the sources run as one sentence in a dimmed ink, and one name at a time is lit in the full
 * ink, moving every two seconds. It holds still with reduced motion, while hovered or focused, and off screen.
 */
export function LitNames({ lead, sources }: { lead: string; sources: Source[] }) {
  const [lit, setLit] = useState(0);
  const [hold, setHold] = useState(false);

  useEffect(() => {
    if (hold || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") setLit((i) => (i + 1) % sources.length);
    }, 2000);
    return () => window.clearInterval(t);
  }, [hold, sources.length]);

  return (
    <p className="rs-line" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <span className="rs-lead">{lead} </span>
      {sources.map((s, i) => (
        <Fragment key={s.href}>
          <a className="rs-name" href={s.href} data-lit={i === lit ? "" : undefined} target="_blank" rel="noreferrer">
            {s.name}
          </a>
          {i < sources.length - 2 ? ", " : i === sources.length - 2 ? ", and " : "."}
        </Fragment>
      ))}
    </p>
  );
}
