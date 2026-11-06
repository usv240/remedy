/**
 * The recall side of a claim: the recall, its proof rule, what the owner sees for it, and the shapes the verifier
 * reads. Server only (it reads content/ from disk). Pure helpers live in `./recall-text` so tests and client code can
 * use them without the file system.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractBaseline, type ProofRule } from "@/lib/recall/proof-rule";
import { loadRecalls } from "@/lib/recall/search";
import type { Recall } from "@/lib/recall/types";
import type { RecallImage, VerifyProofRule, VerifyRecall } from "@/lib/verify/types";
import { exampleFor, plainHazard, productName, type MadeSafeExample } from "./recall-text";

export { isRecallNumber, parseRecallInput, plainHazard, productName, exampleFor, MADE_SAFE_EXAMPLES, type MadeSafeExample } from "./recall-text";

const ROOT = process.cwd();

type RulesFile = { rules: Record<string, ProofRule>; model?: string; extractedAt?: string };
let rulesCache: RulesFile | null = null;
function rulesFile(): RulesFile {
  rulesCache ??= JSON.parse(readFileSync(path.join(ROOT, "content", "recalls", "proof-rules.json"), "utf8")) as RulesFile;
  return rulesCache;
}

export function getRecall(number: string): Recall | null {
  return loadRecalls().find((r) => r.number === number) ?? null;
}

/** Where the rule came from: the stored Claude extraction, or the deterministic quick read when none is stored. */
export type RuleSource = "ai" | "quick_read";
export type RuleFor = { rule: ProofRule; source: RuleSource; model: string | null };

export function ruleFor(r: Recall): RuleFor {
  const f = rulesFile();
  const stored = f.rules[r.number];
  if (stored) return { rule: stored, source: "ai", model: f.model ?? "claude-opus-5-5" };
  return { rule: extractBaseline(r), source: "quick_read", model: null };
}

/** The CPSC thumbnail saved for an image (public/recalls/<number>/<n>.webp), or null. */
export function thumbFor(number: string, index: number): string | null {
  const rel = `/recalls/${number}/${index + 1}.webp`;
  return existsSync(path.join(ROOT, "public", rel)) ? rel : null;
}

/** Fixture copies of official images (content/verify/fixtures/credits.json), so the verifier reads them from disk. */
let localCache: Map<string, string> | null = null;
const urlKey = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
function localOfficial(url: string): Buffer | undefined {
  if (!localCache) {
    localCache = new Map();
    try {
      const credits = JSON.parse(readFileSync(path.join(ROOT, "content", "verify", "fixtures", "credits.json"), "utf8")) as { files: { file: string; source?: string }[] };
      for (const f of credits.files) if (f.source && f.file.startsWith("official/")) localCache.set(urlKey(f.source), f.file);
    } catch {
      /* no fixtures: every image is downloaded */
    }
  }
  const file = localCache.get(urlKey(url));
  if (!file) return undefined;
  try {
    return readFileSync(path.join(ROOT, "content", "verify", "fixtures", file));
  } catch {
    return undefined;
  }
}

/** The recall as the verifier reads it. Official images come from disk when a fixture copy exists, else from cpsc.gov. */
export function verifyRecallFor(r: Recall): VerifyRecall {
  const images: RecallImage[] = r.images.map((i) => ({ url: i.url, caption: i.caption || null, data: localOfficial(i.url) }));
  return {
    number: r.number,
    title: r.title,
    description: r.description || null,
    remedyText: r.remedyText,
    products: r.products.map((p) => ({ name: p.name, model: p.model || null, description: p.description || null, type: p.type || null, units: p.units ?? p.unitsText ?? null })),
    images,
    units: r.units ?? r.products[0]?.unitsText ?? null,
  };
}

export const verifyRuleFor = (rule: ProofRule): VerifyProofRule => rule;

/** The demo recalls (content/recalls/demo-picks.json), as quick picks for "Find your recall". */
export function demoPicks(): { number: string; product: string; title: string; date: string; image: string | null; photo_refund: boolean }[] {
  let numbers: string[] = [];
  try {
    const j = JSON.parse(readFileSync(path.join(ROOT, "content", "recalls", "demo-picks.json"), "utf8")) as { picks?: { number: string }[] };
    numbers = (j.picks ?? []).map((p) => p.number);
  } catch {
    numbers = [];
  }
  return numbers.flatMap((n) => {
    const r = getRecall(n);
    return r ? [{ number: r.number, product: productName(r), title: r.title, date: r.date, image: thumbFor(r.number, 0), photo_refund: r.photoRefund }] : [];
  });
}

/** What the owner's pages show for a recall. Safe to send to the browser: all public CPSC data. */
export type PublicRecall = {
  number: string;
  title: string;
  date: string;
  product: string;
  model: string | null;
  firm: string | null;
  hazard: string;
  hazardFull: string;
  remedyText: string;
  units: number | null;
  unitsText: string;
  category: string;
  url: string;
  photoRefund: boolean;
  images: { src: string; original: string; caption: string }[];
  rule: ProofRule;
  ruleSource: RuleSource;
  ruleModel: string | null;
  example: MadeSafeExample | null;
};

export function publicRecall(r: Recall): PublicRecall {
  const { rule, source, model } = ruleFor(r);
  const images = r.images.map((img, i) => ({ src: thumbFor(r.number, i) ?? img.url, original: img.url, caption: img.caption }));
  return {
    number: r.number,
    title: r.title,
    date: r.date,
    product: productName(r),
    model: r.products.map((p) => p.model).filter(Boolean).join(", ").slice(0, 160) || null,
    firm: r.manufacturers[0] ?? null,
    hazard: plainHazard(r.hazard, r.title),
    hazardFull: r.hazard,
    remedyText: r.remedyText,
    units: r.units,
    unitsText: r.products[0]?.unitsText ?? "",
    category: r.category,
    url: r.url,
    photoRefund: r.photoRefund,
    images: images.filter((i) => i.src.startsWith("/")).concat(images.filter((i) => !i.src.startsWith("/"))).slice(0, 6),
    rule,
    ruleSource: source,
    ruleModel: model,
    example: exampleFor(rule),
  };
}
