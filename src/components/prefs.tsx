"use client";

import { FloatingDelayGroup } from "@floating-ui/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Prefs = {
  mode: "plain" | "technical";
  labels: "on" | "off";
  theme: "system" | "light" | "dark";
  text: "standard" | "large";
};

const KEY = "remedy-prefs";
const DEFAULTS: Prefs = { mode: "plain", labels: "off", theme: "light", text: "standard" };

/** Runs before paint so the theme, text size and labels never flash. */
export const PREFS_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem('${KEY}')||'{}');var d=document.documentElement;d.dataset.theme=p.theme||'light';d.dataset.text=p.text||'standard';d.dataset.labels=p.labels||'off';d.dataset.mode=p.mode||'plain';var q=new URLSearchParams(location.search);['theme','mode','text','labels'].forEach(function(k){var v=q.get(k);if(v)d.dataset[k]=v;});}catch(e){}})();`;

type Ctx = { prefs: Prefs; set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void };
const PrefsContext = createContext<Ctx>({ prefs: DEFAULTS, set: () => {} });

function readStored(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    // Sync with what the pre-paint script already applied; localStorage is only readable on the client.
    const stored = readStored();
    const q = new URLSearchParams(window.location.search);
    for (const k of ["theme", "mode", "text", "labels"] as const) {
      const v = q.get(k);
      if (v) (stored as Record<string, string>)[k] = v;
    }
    // A first visit has nothing stored: keep the same object, so nothing that reads the preferences renders twice.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs((prev) => ((Object.keys(DEFAULTS) as (keyof Prefs)[]).every((k) => prev[k] === stored[k]) ? prev : stored));
  }, []);

  const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: the choice still applies for this visit */
      }
      document.documentElement.dataset[key] = String(value);
      return next;
    });
  }, []);

  return (
    <PrefsContext.Provider value={{ prefs, set }}>
      <FloatingDelayGroup delay={{ open: 300, close: 120 }} timeoutMs={500}>
        {children}
      </FloatingDelayGroup>
    </PrefsContext.Provider>
  );
}

export const usePrefs = () => useContext(PrefsContext);
