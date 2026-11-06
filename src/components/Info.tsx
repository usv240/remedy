"use client";

import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useClick,
  useDelayGroup,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import Link from "next/link";
import { useId, useState, type CSSProperties } from "react";
import infoContent from "../../content/info.json";
import { usePrefs } from "./prefs";

export type InfoEntry = {
  title: string;
  what: string;
  why: string;
  technical?: string;
  learnMore?: { label: string; href: string };
  sponsor?: string[];
};

const CONTENT = infoContent as Record<string, InfoEntry>;

/** The Info entry for an id, or undefined. tests/info.test.ts checks that every id the code uses has one. */
export const infoEntry = (id: string): InfoEntry | undefined => CONTENT[id];

/** The tip grows out of its dot, so its origin is the corner nearest the trigger, wherever flip() put it. */
function originFor(placement: string) {
  const [side, align] = placement.split("-");
  const x = align === "start" ? "left" : align === "end" ? "right" : "center";
  if (side === "top") return `bottom ${x}`;
  if (side === "bottom") return `top ${x}`;
  const y = align === "start" ? "top" : align === "end" ? "bottom" : "center";
  return `${y} ${side === "left" ? "right" : "left"}`;
}

/**
 * A toggletip. Its accessible name is "About <topic>": `topic` when given (for example the heading it sits beside),
 * otherwise the entry's own title. `label` is the small visible word beside the dot, hidden when empty.
 */
export function Info({ id, label = "info", entry, topic }: { id: string; label?: string; entry?: InfoEntry; topic?: string }) {
  const data = entry ?? CONTENT[id];
  const { prefs } = usePrefs();
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hoverOpen || pinned;
  const popId = useId();

  const {
    refs: { setReference, setFloating },
    floatingStyles,
    placement,
    context,
  } = useFloating({
    open,
    onOpenChange: (next, _event, reason) => {
      if (reason === "hover" || reason === "focus") setHoverOpen(next);
      else if (reason === "click") setPinned(next);
      else {
        setHoverOpen(false);
        setPinned(false);
      }
    },
    placement: "bottom-start",
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  // Inside the app-wide FloatingDelayGroup: once one Info has opened, the next open instantly (Emil).
  const { delay, isInstantPhase: instant } = useDelayGroup(context, { id: popId });
  const hover = useHover(context, { enabled: !pinned, mouseOnly: true, delay, handleClose: safePolygon() });
  const focus = useFocus(context, { enabled: !pinned });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role]);

  if (!data) {
    if (process.env.NODE_ENV !== "production") console.warn(`Info entry missing: ${id}`);
    return null;
  }

  return (
    <>
      <button
        ref={setReference}
        type="button"
        className="info-trigger"
        aria-label={`About ${topic || data.title}`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-info-id={id}
        {...getReferenceProps()}
      >
        <span className="info-dot" aria-hidden="true" />
        <span className="info-label" aria-hidden="true">
          {label}
        </span>
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={setFloating}
            id={popId}
            style={{ ...floatingStyles, "--info-origin": originFor(placement) } as CSSProperties}
            className="info-pop"
            data-instant={instant ? "" : undefined}
            aria-label={data.title}
            {...getFloatingProps()}
          >
            <p className="info-pop-title">{data.title}</p>
            <p>{data.what}</p>
            <p className="info-pop-why">{data.why}</p>
            {prefs.mode === "technical" && data.technical && <p className="info-pop-tech">{data.technical}</p>}
            {prefs.mode === "technical" && data.sponsor && data.sponsor.length > 0 && (
              <p className="info-pop-sponsor">Uses {data.sponsor.join(", ")}</p>
            )}
            {data.learnMore && (
              <p>
                <Link className="text-link" href={data.learnMore.href}>
                  {data.learnMore.label}
                </Link>
              </p>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
