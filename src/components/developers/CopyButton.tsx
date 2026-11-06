"use client";

import { useEffect, useRef, useState } from "react";

/** Copies a snippet, a key or an address, and says "Copied" for a moment. If the clipboard is blocked, the text stays on screen to select. */
export function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`btn btn-quiet dev-copy ${className}`.trim()}
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked: the text stays visible to select by hand */
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
