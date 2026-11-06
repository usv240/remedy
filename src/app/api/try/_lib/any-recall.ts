/**
 * "Any recall" on /try: a pasted CPSC recall number or recall page URL becomes the recall and its proof rule. Recalls
 * in Remedy's list use their stored rule; any other recall is fetched live from the CPSC API and read with the
 * deterministic baseline, labelled a quick read. No model call. Server only.
 */
import { fetchCpscRecall } from "@/lib/recall/cpsc-client";
import { normalizeRecall } from "@/lib/recall/ingest";
import { extractBaseline } from "@/lib/recall/proof-rule";
import { loadRecalls } from "@/lib/recall/search";
import type { Recall } from "@/lib/recall/types";
import { publicRecall, type PublicRecall } from "../../claims/_lib/recall";
import { parseRecallInput, recallSlug } from "../../claims/_lib/recall-text";

export type AnyRecallResult =
  | { found: true; from: "list" | "cpsc_live"; recall: PublicRecall; in_remedy: boolean; claim_url: string | null }
  | { found: false; message: string };

export async function lookupAnyRecall(raw: string): Promise<AnyRecallResult> {
  const parsed = parseRecallInput(raw);
  if (!parsed) return { found: false, message: "Paste a CPSC recall number, such as 27056, or the address of a recall page on cpsc.gov." };
  const all = loadRecalls();
  let r: Recall | undefined;
  if ("url" in parsed) {
    r = all.find((x) => recallSlug(x.url) === parsed.url);
    if (!r) return { found: false, message: "That recall page is not in Remedy's list of recalls since January 2024. Paste its recall number instead; it is shown on the recall page." };
  } else {
    r = all.find((x) => x.number === parsed.number);
  }
  if (r) return { found: true, from: "list", recall: publicRecall(r), in_remedy: true, claim_url: `/claim/${r.number}` };

  const number = (parsed as { number: string }).number;
  let raw2;
  try {
    raw2 = await fetchCpscRecall(number);
  } catch {
    return { found: false, message: "The CPSC recall service did not answer just now. Please try again in a minute." };
  }
  if (!raw2) return { found: false, message: `The CPSC has no recall numbered ${number}. Check the number on the recall page.` };
  const live = normalizeRecall(raw2);
  const view = publicRecall(live);
  // Not in the stored list, so there is no stored rule: the deterministic quick read.
  return { found: true, from: "cpsc_live", recall: { ...view, rule: extractBaseline(live), ruleSource: "quick_read", ruleModel: null }, in_remedy: false, claim_url: null };
}
