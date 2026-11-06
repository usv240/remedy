/**
 * Pure helpers for the owner's view of a recall: no file system, no network, so tests and client code can use them.
 */
import type { ProofRule } from "@/lib/recall/proof-rule";

/**
 * Brightline Home's fictional sample recalls are numbered "BH-2026-01" (content/recalls/samples.json), a form no CPSC
 * recall uses, so a sample can never be mistaken for a real recall number.
 */
export const SAMPLE_NUMBER = /^BH-\d{4}-\d{2}$/;
export const isSampleNumber = (s: string) => SAMPLE_NUMBER.test(s);

/** CPSC recall numbers are five digits ("27056"); a few older ones run four to six. Sample numbers are accepted too. */
export const isRecallNumber = (s: string) => /^\d{4,6}$/.test(s) || isSampleNumber(s);

/**
 * A recall number from what an owner pastes: "27056", "Recall 27056", "#27056", or a cpsc.gov recall URL. A URL has no
 * number in it, so it comes back as `url` and is matched against the recall list. A sample number ("bh-2026-01")
 * comes back in capitals.
 */
export function parseRecallInput(raw: string): { number: string } | { url: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const sample = /\bBH-\d{4}-\d{2}\b/i.exec(s);
  if (sample) return { number: sample[0].toUpperCase() };
  const asUrl = /^(?:https?:\/\/)?(?:www\.)?cpsc\.gov\/Recalls\/\d{4}\/([^\s?#]+)/i.exec(s);
  if (asUrl) return { url: asUrl[1].replace(/\/$/, "").toLowerCase() };
  const n = /(?:^|\D)(\d{4,6})(?:\D|$)/.exec(s);
  return n ? { number: n[1] } : null;
}

/** The recall page's own path ("haiara-power-banks-recalled-..."), for matching a pasted URL. */
export const recallSlug = (url: string) => (/\/Recalls\/\d{4}\/([^?#]+)/i.exec(url)?.[1] ?? "").replace(/\/$/, "").toLowerCase();

/**
 * The hazard in one plain sentence. CPSC's own first sentence when it is short; otherwise the risk named in the title
 * ("... Due to Risk of Serious Injury or Death from Electrocution, Shock and Burn Hazards").
 */
export function plainHazard(hazard: string, title: string): string {
  const first = (hazard.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? hazard).trim();
  if (first && first.length <= 170) return first;
  const due = /\bDue to (?:a |the )?(.+?)(?:;|$)/i.exec(title)?.[1]?.trim();
  if (due) {
    const s = due.charAt(0).toUpperCase() + due.slice(1).toLowerCase();
    return `${s.replace(/\.$/, "")}.`;
  }
  return first.length > 220 ? `${first.slice(0, 217).replace(/\s+\S*$/, "")}...` : first;
}

/** The product as owners know it: the first product name, or the title before "Recalled" or "Due to". */
export function productName(r: { products: { name: string }[]; title: string }): string {
  const p = r.products.find((x) => x.name?.trim())?.name.trim();
  if (p) return p;
  return r.title.split(/\s+(?:Recalled|Recalls|Due to)\b/i)[0].trim();
}

/**
 * Real made-safe photos the CPSC published with two recalls, shown as "the kind of photo the firm accepts". Public
 * domain (US government work); credited where shown.
 */
export type MadeSafeExample = { recall: string; src: string; original: string; caption: string; alt: string; action: string; width: number; height: number };
export const MADE_SAFE_EXAMPLES: Record<string, MadeSafeExample> = {
  cut_cord: {
    recall: "26125",
    src: "/recalls/26125/1.webp",
    original: "https://www.cpsc.gov/s3fs-public/RecalledMyOnlyStylerRootBoosterHairDryer.png",
    caption: "A hair dryer with its cord cut in half, from CPSC recall 26125.",
    alt: "A hand-held hair dryer on a table with its power cord cut through, the two cut ends side by side.",
    action: "cut_cord",
    width: 320,
    height: 205,
  },
  straps: {
    recall: "25007",
    src: "/recalls/25007/4.webp",
    original: "https://www.cpsc.gov/s3fs-public/Droyd4.jpg",
    caption: "A helmet with its straps cut off, from CPSC recall 25007.",
    alt: "A bike helmet seen from below, with both chin straps cut off.",
    action: "other",
    width: 320,
    height: 390,
  },
};

/** The CPSC example that matches what this rule asks for, if one exists. */
export function exampleFor(rule: Pick<ProofRule, "actions" | "steps">): MadeSafeExample | null {
  if (rule.actions.includes("cut_cord")) return MADE_SAFE_EXAMPLES.cut_cord;
  if (rule.actions.includes("other") && rule.steps.some((s) => /\bstraps?\b/i.test(s))) return MADE_SAFE_EXAMPLES.straps;
  return null;
}

/** The query a safe-replacement search starts from: the product name without its brand. */
export function replacementQuery(r: { products: { name: string; type?: string }[]; title: string; category?: string }): string {
  const name = productName(r);
  const words = name.split(/\s+/);
  // Brands are usually the first word, often in capitals ("HAIARA power banks", "QZH.DUAO Children's Pajama Sets").
  const rest = words.length > 1 && (/^[A-Z0-9.&'-]{2,}$/.test(words[0]) || /[A-Z].*[A-Z]/.test(words[0]) || words.length > 2) ? words.slice(1) : words;
  const q = rest
    .join(" ")
    .replace(/[’']s\b/g, "s")
    .replace(/\b(recalled|sets?)\b/gi, (m) => (/sets?/i.test(m) ? "set" : ""))
    .replace(/\s+/g, " ")
    .trim();
  return (q || r.category || name).slice(0, 80);
}
