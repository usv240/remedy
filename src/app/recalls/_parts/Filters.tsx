"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, useTransition, type FormEvent } from "react";
import { hrefFor, type FilterValues } from "./href";

type Opt = { value: string; label?: string; count: number };
export type FilterChoices = { years: Opt[]; categories: Opt[]; remedies: Opt[]; units: Opt[] };

/**
 * The explorer's search and filters. A plain GET form, so it works with no script; with script, a change to any
 * select applies at once and the search applies on submit, through the router (no full reload, scroll kept).
 */
export function Filters({ values, choices }: { values: FilterValues; choices: FilterChoices }) {
  const router = useRouter();
  const path = usePathname();
  const form = useRef<HTMLFormElement>(null);
  const [busy, start] = useTransition();

  const apply = () => {
    const f = form.current;
    if (!f) return;
    const d = new FormData(f);
    const next = Object.fromEntries([...d.entries()].map(([k, v]) => [k, String(v)])) as Partial<FilterValues>;
    start(() => router.push(hrefFor(path, next), { scroll: false }));
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    apply();
  };
  const select = (name: keyof FilterValues, label: string, opts: Opt[], any: string) => (
    <label className="rx-field">
      <span className="rx-label">{label}</span>
      <select name={name} defaultValue={values[name]} onChange={apply}>
        <option value="">{any}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value} ({o.count.toLocaleString("en-US")})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form ref={form} className="rx-form" method="get" action={path} onSubmit={onSubmit} role="search" data-busy={busy ? "" : undefined}>
      <div className="rx-search">
        <label className="rx-field rx-q">
          <span className="rx-label">Search</span>
          <input name="query" type="search" defaultValue={values.query} placeholder="A product, a brand, or what went wrong" maxLength={200} enterKeyHint="search" />
        </label>
        <button type="submit" className="btn btn-ink rx-go">
          {busy ? "Searching…" : "Search"}
        </button>
      </div>
      {/* Kept so a search or another filter does not drop the photo-refund choice made with the count cards. */}
      <input type="hidden" name="photo_refund" value={values.photo_refund} />
      <div className="rx-selects">
        {select("year", "Year", choices.years, "Any year")}
        {select("category", "Product type", choices.categories, "Any product")}
        {select("remedy", "Remedy", choices.remedies, "Any remedy")}
        {select("units", "Units recalled", choices.units, "Any number")}
      </div>
      <noscript>
        <button type="submit" className="btn btn-quiet">
          Apply filters
        </button>
      </noscript>
    </form>
  );
}
