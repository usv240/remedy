"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A value that is masked until the visitor asks for it, with Copy and Show controls (44 px, keyboard reachable). Used for
 * the sandbox buyer password: a test login PayPal publishes for its sandbox, shown masked so a screenshot or a glance
 * over a shoulder does not print it, and copied in one press for the PayPal window.
 */
export function SecretValue({ value, label }: { value: string; label: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const mask = "•".repeat(Math.min(12, Math.max(8, value.length)));
  return (
    <span className="secret" data-shown={shown ? "" : undefined}>
      <code className="secret-value" aria-label={shown ? `${label}: ${value}` : `${label}, hidden`}>
        {shown ? value : mask}
      </code>
      <span className="secret-actions">
        <button
          type="button"
          className="btn btn-quiet secret-btn"
          aria-live="polite"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setCopied(false), 1600);
            } catch {
              // The clipboard is blocked: show the value so it can be selected by hand.
              setShown(true);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-quiet secret-btn" aria-pressed={shown} onClick={() => setShown((v) => !v)}>
          {shown ? "Hide" : "Show"}
        </button>
      </span>
    </span>
  );
}
