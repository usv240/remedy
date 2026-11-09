"use client";

import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useState } from "react";
import { Info } from "./Info";
import { usePrefs, type Prefs } from "./prefs";

type Option<K extends keyof Prefs> = { value: Prefs[K]; label: string };

function Segmented<K extends keyof Prefs>({ name, label, options, infoId, scope }: { name: K; label: string; options: Option<K>[]; infoId: string; scope: string }) {
  const { prefs, set } = usePrefs();
  return (
    <fieldset className="view-row">
      <legend className="view-legend">
        {label} <Info id={infoId} label="" />
      </legend>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <label key={String(o.value)} className="seg-opt" data-on={prefs[name] === o.value ? "" : undefined}>
            <input type="radio" name={`pref-${scope}-${String(name)}`} value={String(o.value)} checked={prefs[name] === o.value} onChange={() => set(name, o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The menu's words. The header shows the view in use and offers the other one as the action. */
const WORDS = {
  title: "Display settings",
  mode: ["Explanations", "Plain", "Technical"],
  labels: ["Info labels", "Show", "Hide"],
  theme: ["Theme", "Light", "Dark", "System"],
  text: ["Text size", "Standard", "Large"],
} as const;

/** The four display settings as rows of choices: in the header's popover, and in the phone menu (`scope` keeps each set of radios its own group). */
export function DisplaySettings({ scope = "pop" }: { scope?: string }) {
  const w = WORDS;
  return (
    <>
      <Segmented
        name="mode"
        label={w.mode[0]}
        infoId="view.mode"
        scope={scope}
        options={[
          { value: "plain", label: w.mode[1] },
          { value: "technical", label: w.mode[2] },
        ]}
      />
      <Segmented
        name="labels"
        label={w.labels[0]}
        infoId="view.labels"
        scope={scope}
        options={[
          { value: "on", label: w.labels[1] },
          { value: "off", label: w.labels[2] },
        ]}
      />
      <Segmented
        name="theme"
        label={w.theme[0]}
        infoId="view.theme"
        scope={scope}
        options={[
          { value: "light", label: w.theme[1] },
          { value: "dark", label: w.theme[2] },
          { value: "system", label: w.theme[3] },
        ]}
      />
      <Segmented
        name="text"
        label={w.text[0]}
        infoId="view.text"
        scope={scope}
        options={[
          { value: "standard", label: w.text[1] },
          { value: "large", label: w.text[2] },
        ]}
      />
    </>
  );
}

/**
 * The view switch: one button that says which view is showing and offers the other ("Showing: Plain", then "Switch
 * to Technical"). Both lines are its accessible name, so a screen reader hears the state and the action; after a
 * press, a polite status says the new view. The words follow the root's data-mode, which the pre-paint script sets,
 * so a reader who chose Technical never sees Plain first.
 */
export function ViewSwitch({ className = "" }: { className?: string }) {
  const { set } = usePrefs();
  const [said, setSaid] = useState("");
  function swap() {
    const next = document.documentElement.dataset.mode === "technical" ? "plain" : "technical";
    set("mode", next);
    setSaid(`Showing the ${next === "technical" ? "Technical" : "Plain"} view.`);
  }
  return (
    <>
      <button type="button" className={`btn btn-quiet view-swap ${className}`.trim()} onClick={swap}>
        <span className="view-now">
          <span className="vm-plain">Showing: Plain</span>
          <span className="vm-tech">Showing: Technical</span>
        </span>
        <span className="view-act">
          <span className="vm-plain">Switch to Technical</span>
          <span className="vm-tech">Switch to Plain</span>
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </>
  );
}

export function ViewMenu() {
  const w = WORDS;
  const [open, setOpen] = useState(false);
  const {
    refs: { setReference, setFloating },
    floatingStyles,
    context,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: "dialog" })]);

  return (
    <>
      <ViewSwitch />
      <button ref={setReference} type="button" className="btn btn-quiet view-btn" aria-label={w.title} aria-expanded={open} {...getReferenceProps()}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
          <path d="M3 6h8M15 6h2M3 14h2M9 14h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="13" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="7" cy="14" r="2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div ref={setFloating} style={floatingStyles} className="view-pop" aria-label={w.title} {...getFloatingProps()}>
              <DisplaySettings />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
