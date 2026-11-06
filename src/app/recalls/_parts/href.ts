/** The explorer's filter values, as they appear in its URL. Shared by the server page and the client form. */
export type FilterValues = { query: string; photo_refund: string; year: string; category: string; remedy: string; units: string };

/** The URL for a set of filter values: empty values are left out, so links stay short. */
export function hrefFor(path: string, v: Partial<FilterValues> & { show?: number }) {
  const p = new URLSearchParams();
  for (const [k, val] of Object.entries(v)) if (val !== undefined && val !== "" && !(k === "show" && Number(val) <= 20)) p.set(k, String(val));
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}
