/** Small formatters for recall data on the public pages. Client-safe. */

/** "HAIARA Power Banks Recalled Due to Risk of ..." becomes "HAIARA Power Banks". */
export function shortTitle(title: string): string {
  let t = title.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+(?:Due to|Because of|After|Following)\b.*$/i, "");
  t = t.replace(/\s+(?:Recalled|Recall)\s*$/i, "");
  // "Acme Recalls Toasters" keeps what was recalled: "Toasters by Acme" reads oddly, so keep "Acme Toasters".
  t = t.replace(/^(.{2,60}?)\s+(?:Recalls|Recall|Announces Recall of|Recalling)\s+/i, "$1 ");
  t = t.replace(/[;,]\s*$/, "");
  return t.length > 90 ? `${t.slice(0, 87).replace(/\s+\S*$/, "")}...` : t;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-29" becomes "Oct 29, 2026", with no time zone shift. */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** 11000 becomes "11,000 units"; null becomes "Units not given". */
export const fmtUnits = (n: number | null | undefined) => (typeof n === "number" ? `${n.toLocaleString("en-US")} ${n === 1 ? "unit" : "units"}` : "Units not given");

export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** Milliseconds as "14.8 s" or "46 ms". */
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
