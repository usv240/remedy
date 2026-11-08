import split from "../../../content/recalls/proof-split.json";
import type { ProofSplit } from "./made-safe";

/**
 * The one source for the headline count every page, the README and llms.txt repeat: the recalls whose proof rule asks
 * for a photo of the product made safe and pays a refund in money (content/recalls/proof-split.json, written by
 * scripts/recalls/value.ts and recomputed by tests/recall-value.test.ts). tests/facts.test.ts holds the README to it.
 */
export const SPLIT = split as ProofSplit & { pulledAt: string; range: { from: string; to: string }; note: string };

/** The headline: count, share of every recall, and by year. */
export const HEADLINE = SPLIT.madeSafeRefund;

/** "One decimal" share, split for the stats column: whole and decimals. */
export const shareParts = (n: number) => ({ whole: String(Math.trunc(n)), dec: `.${(n.toFixed(1).split(".")[1] ?? "0")}` });
