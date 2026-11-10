import type { ReadLabel } from "./reading";

/**
 * The answer to "is it recalled?" from one label, as the page, POST /api/v1/label and the check_label MCP tool return
 * it. Client-safe types only.
 *
 *   match       one recall lists a model number or UPC read from the label: code settled it.
 *   candidates  no code settled it, but recalls are close (another model of the same brand and product, or several
 *               recalls listing the same code): the owner compares and picks.
 *   no_match    nothing in the recall list since January 2024 names what the label shows.
 *   unreadable  the label could not be read well enough to look anything up.
 *   person      a person can be seen in the photo, so the reading is not used: a photo of the label alone is asked for.
 */
export type LabelOutcome = "match" | "candidates" | "no_match" | "unreadable" | "person";

export type LabelMatch = {
  number: string;
  title: string;
  product: string;
  date: string;
  sample: boolean;
  photo_refund: boolean;
  /** The remedy in a few words. */
  remedy_summary: string;
  refund_amount: number | null;
  refund_amount_text: string | null;
  /** The owner's claim page on this server, for a photo-refund recall. */
  claim_url: string | null;
  page: string;
  cpsc_url: string;
  image: string | null;
  matched_by: "model" | "upc" | "keywords";
  /** The code as read from the label that settled it, for model and upc. */
  code: string | null;
  /** How it matched, in one plain sentence: "Matched by model number KC101B, read from your photo." */
  how: string;
  /** The model numbers the recall itself lists, so the owner can compare with the label. */
  recall_models: string[];
  /** Lot, batch or date codes: what the recall says beside what the label shows, for the owner to compare. Nothing is decided from them here. */
  compare: { recall_states: string[]; label_shows: string[] } | null;
};

export type LabelCheck = {
  outcome: LabelOutcome;
  /** One plain sentence for the owner. */
  plain: string;
  /** What code did, for a developer. */
  technical: string;
  matches: LabelMatch[];
  /** The words to search by name when nothing matched (brand and product as read). */
  search: string;
  label: ReadLabel;
  /** Where the reading came from: read just now, or a recorded reading of a sample label replayed with no model call. */
  source: { kind: "live" | "recorded"; model: string; recorded_at: string | null; sample: string | null; ms: number; cost_usd: number };
};
