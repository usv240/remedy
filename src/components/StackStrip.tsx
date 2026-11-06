"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, Suspense } from "react";
import { Info } from "./Info";

// Only tools the running code uses. Add one here when its code ships and is called, not before.
export const STACK = [
  { id: "paypal", name: "PayPal" },
  { id: "claude", name: "Claude" },
  { id: "elastic", name: "Elastic" },
  { id: "channel3", name: "Channel3" },
  { id: "bryntum", name: "Bryntum" },
  { id: "ag-grid", name: "AG Grid" },
  { id: "apimatic", name: "APIMatic" },
  { id: "render", name: "Render" },
] as const;

/** Shown above the footer on every page but printable records: every tool used, with what it does here. */
export function StackStrip() {
  return (
    <Suspense fallback={null}>
      <StackStripAt />
    </Suspense>
  );
}

function StackStripAt() {
  const path = usePathname() ?? "/";
  // A claim receipt and a printable report are documents; they end with the record. The home page names every tool in
  // its own "Every tool has one job" table, so the sentence would only repeat it.
  if (path === "/" || /^\/claim\/[^/]+\/done\/|^\/firm\/reports\/print/.test(path)) return null;
  return (
    <section className="stack-strip frame" aria-labelledby="stack-strip-title">
      <h2 id="stack-strip-title" className="sr-only">
        Built with
      </h2>
      <p className="stack-sentence">
        Built with{" "}
        {STACK.map((t, i) => (
          <Fragment key={t.id}>
            <Link href={`/stack#${t.id}`} className="text-link stack-item">
              {t.name}
            </Link>
            {i < STACK.length - 2 ? ", " : i === STACK.length - 2 ? " and " : "."}
          </Fragment>
        ))}{" "}
        <Info id="stack.strip" />
      </p>
    </section>
  );
}
