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

function Segmented<K extends keyof Prefs>({ name, label, options, infoId }: { name: K; label: string; options: Option<K>[]; infoId: string }) {
  const { prefs, set } = usePrefs();
  return (
    <fieldset className="view-row">
      <legend className="view-legend">
        {label} <Info id={infoId} label="" />
      </legend>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <label key={String(o.value)} className="seg-opt" data-on={prefs[name] === o.value ? "" : undefined}>
            <input type="radio" name={`pref-${String(name)}`} value={String(o.value)} checked={prefs[name] === o.value} onChange={() => set(name, o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The menu's words. The button names what it mostly does: switch between the Plain and Technical views. */
const WORDS = {
  button: "Plain or Technical",
  title: "Display settings",
  mode: ["Explanations", "Plain", "Technical"],
  labels: ["Info labels", "Show", "Hide"],
  theme: ["Theme", "Light", "Dark", "System"],
  text: ["Text size", "Standard", "Large"],
} as const;

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
      <button ref={setReference} type="button" className="btn btn-quiet view-btn" aria-expanded={open} {...getReferenceProps()}>
        {w.button}
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div ref={setFloating} style={floatingStyles} className="view-pop" aria-label={w.title} {...getFloatingProps()}>
              <Segmented
                name="mode"
                label={w.mode[0]}
                infoId="view.mode"
                options={[
                  { value: "plain", label: w.mode[1] },
                  { value: "technical", label: w.mode[2] },
                ]}
              />
              <Segmented
                name="labels"
                label={w.labels[0]}
                infoId="view.labels"
                options={[
                  { value: "on", label: w.labels[1] },
                  { value: "off", label: w.labels[2] },
                ]}
              />
              <Segmented
                name="theme"
                label={w.theme[0]}
                infoId="view.theme"
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
                options={[
                  { value: "standard", label: w.text[1] },
                  { value: "large", label: w.text[2] },
                ]}
              />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
