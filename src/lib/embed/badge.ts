/**
 * The embeddable recall badge: one chrome-free HTML page for an iframe, rendered on the server with every input
 * escaped. It says the recall's one-line remedy and refund and links to the owner's claim page. Colors are Remedy's
 * tokens, light by default and dark under prefers-color-scheme. Server only.
 */
import { recallByNumber, refreshOverlay, storedRule, summarize } from "@/lib/api/recall-data";
import { actionLabel, remedyLabel } from "@/lib/api/rule-chips";
import { shortTitle } from "@/lib/api/format";
import { searchRecalls } from "@/lib/recall/search";
import type { Recall } from "@/lib/recall/types";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export type BadgeData = {
  found: boolean;
  recall: { number: string; title: string; short: string; date: string; photoRefund: boolean; sample: boolean } | null;
  /** The remedy in one line, for example "Write RECALLED on it, send one photo: full refund." */
  line: string;
  /** "Full refund", "$25 refund", "Repair or replacement". */
  refund: string;
  claimPath: string | null;
};

/** The remedy in one line from the stored proof rule, or from the CPSC's remedy options. */
export function remedyLine(r: Recall): { line: string; refund: string } {
  const rule = storedRule(r.number)?.rule;
  const s = rule ? summarize(rule) : null;
  if (r.photoRefund && s) {
    const todo = s.actions.map((a) => actionLabel(a, s).replace(/^Write (\S+)$/, "Write $1 on it").replace(/^Cut in half$/, "Cut it in half").replace(/^Puncture it$/, "Puncture it"));
    const money = s.refund_amount ? `$${Number.isInteger(s.refund_amount) ? s.refund_amount : s.refund_amount.toFixed(2)} refund` : remedyLabel(s.remedy);
    const line = `${todo.length ? `${todo.join(", ")}, then send` : "Send"} one photo: ${money.toLowerCase()}.`;
    return { line, refund: money };
  }
  const options = r.remedies.length ? r.remedies.join(" or ").toLowerCase() : "see the recall";
  return { line: `Stop using it. The firm offers a ${options}; no photo refund through Remedy.`, refund: r.remedies.join(" or ") || "See the recall" };
}

/** Resolve the badge's recall from a number or from words, then its one-line remedy. */
export async function badgeData(o: { recall?: string | null; q?: string | null }): Promise<BadgeData> {
  let r: Recall | null = null;
  await refreshOverlay();
  if (o.recall?.trim()) r = recallByNumber(o.recall.trim().slice(0, 40));
  else if (o.q?.trim()) {
    const res = await searchRecalls(o.q.trim().slice(0, 120), { k: 1 });
    r = res.hits[0] ? recallByNumber(res.hits[0].number) : null;
  }
  if (!r) return { found: false, recall: null, line: "", refund: "", claimPath: null };
  const { line, refund } = remedyLine(r);
  return {
    found: true,
    recall: { number: r.number, title: r.title, short: shortTitle(r.title), date: r.date, photoRefund: r.photoRefund, sample: Boolean(r.sample) },
    line,
    refund,
    claimPath: r.photoRefund ? `/claim/${r.number}` : `/recalls/${r.number}`,
  };
}

const CSS = `
:root{color-scheme:light dark;--bg:#ffffff;--ink:#030407;--muted:#5b606b;--edge:#e2e4dc;--accent:#d4ff24;--accent-ink:#030407;--accent-text:#5c7300;--pill:#dcfae5;--pill-ink:#04250e;--pill-n:#e8eae2;--pill-n-ink:#30332b;--link:#1558c9}
@media (prefers-color-scheme:dark){:root{--bg:#0d0f14;--ink:#f3f4f0;--muted:#9ea3ae;--edge:#1e2230;--accent:#d4ff24;--accent-ink:#030407;--accent-text:#d4ff24;--pill:#0f2a1b;--pill-ink:#c9f2d8;--pill-n:#22252f;--pill-n-ink:#d5d8cf;--link:#6b9bff}}
*{box-sizing:border-box}html,body{margin:0;background:transparent}
body{font:400 0.875rem/1.4 "IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink)}
.b{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 14px;align-items:center;padding:12px 14px;border:1px solid var(--edge);border-radius:12px;background:var(--bg);min-height:6.5rem}
.k{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 4px}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:500;background:var(--pill);color:var(--pill-ink)}
.pill[data-n]{background:var(--pill-n);color:var(--pill-n-ink)}
.n{font-size:0.75rem;color:var(--muted);font-variant-numeric:tabular-nums}
.t{margin:0;font-weight:500;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
.l{margin:2px 0 0;color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border-radius:10px;background:var(--accent);color:var(--accent-ink);font-weight:500;text-decoration:none;white-space:nowrap;transition:transform 120ms ease}
.a:active{transform:scale(0.98)}.a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.a[data-q]{background:transparent;color:var(--ink);border:1px solid var(--edge)}
.f{grid-column:1/-1;margin:0;font-size:0.6875rem;color:var(--muted)}
.f a{color:var(--link)}
@media (max-width:22rem){.b{grid-template-columns:1fr}.a{justify-self:start}}
@media (prefers-reduced-motion:reduce){.a{transition:none}}
`;

/** The badge page. `origin` is this server's public address, so links work inside any site. */
export function badgeHtml(d: BadgeData, origin: string): string {
  const o = origin.replace(/\/$/, "");
  const body = d.found && d.recall
    ? `<div class="b">
<div>
<p class="k">${d.recall.photoRefund ? '<span class="pill">Refund for a photo</span>' : '<span class="pill" data-n>Recalled</span>'}<span class="n">Recall ${esc(d.recall.number)}${d.recall.sample ? ", sample" : ""}</span></p>
<p class="t">${esc(d.recall.short)}</p>
<p class="l">${esc(d.line)}</p>
</div>
<a class="a" ${d.recall.photoRefund ? "" : "data-q "}href="${esc(`${o}${d.claimPath ?? "/"}`)}" target="_blank" rel="noopener">${d.recall.photoRefund ? "Get your refund" : "See the recall"}</a>
<p class="f">${d.recall.sample ? "Sample recall; the firm is fictional. " : "Recall data: US Consumer Product Safety Commission. "}Paid through PayPal by <a href="${esc(o)}/" target="_blank" rel="noopener">Remedy</a>, which is not affiliated with the recalling firm.</p>
</div>`
    : `<div class="b">
<div>
<p class="k"><span class="pill" data-n>No recall found</span></p>
<p class="t">Nothing in the recalls since 2024 matches.</p>
<p class="l">Check the product on cpsc.gov, or search Remedy's recall list.</p>
</div>
<a class="a" data-q href="${esc(o)}/recalls" target="_blank" rel="noopener">Search recalls</a>
<p class="f">Recall data: US Consumer Product Safety Commission. <a href="${esc(o)}/" target="_blank" rel="noopener">Remedy</a> is not affiliated with the CPSC or any recalling firm.</p>
</div>`;
  const title = d.found && d.recall ? `Recall ${d.recall.number}: ${d.recall.short}` : "Recall badge";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

/** The one-script embed: inserts the badge iframe where the script tag sits. */
export function badgeScript(origin: string): string {
  const o = origin.replace(/\/$/, "");
  return `(function(){var s=document.currentScript;if(!s)return;var p=new URLSearchParams();if(s.dataset.recall)p.set("recall",s.dataset.recall);else if(s.dataset.q)p.set("q",s.dataset.q);var f=document.createElement("iframe");f.src=${JSON.stringify(`${o}/api/embed/badge?`)}+p.toString();f.title="Recall badge";f.loading="lazy";f.setAttribute("referrerpolicy","no-referrer");f.style.cssText="border:0;width:100%;max-width:"+(s.dataset.width||"28rem")+";height:"+(s.dataset.height||"7.5rem")+";display:block";s.parentNode.insertBefore(f,s.nextSibling);})();`;
}
