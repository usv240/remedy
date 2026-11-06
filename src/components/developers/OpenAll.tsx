"use client";

import { useEffect, useState } from "react";

/**
 * One button that opens or closes every `<details>` matching `selector`, for readers who want the whole reference at
 * once. Its label follows the rows: once every row is open, by this button or one by one, it offers to close them.
 */
export function OpenAll({ selector, controls }: { selector: string; controls?: string }) {
  const [all, setAll] = useState(false);
  useEffect(() => {
    const sync = () => {
      const rows = [...document.querySelectorAll<HTMLDetailsElement>(selector)];
      setAll(rows.length > 0 && rows.every((d) => d.open));
    };
    sync();
    // toggle does not bubble; a capturing listener still hears every row.
    document.addEventListener("toggle", sync, true);
    return () => document.removeEventListener("toggle", sync, true);
  }, [selector]);
  return (
    <button
      type="button"
      className="btn btn-quiet open-all"
      aria-controls={controls}
      onClick={() => {
        for (const d of document.querySelectorAll<HTMLDetailsElement>(selector)) d.open = !all;
      }}
    >
      {all ? "Close all" : "Open all"}
    </button>
  );
}
