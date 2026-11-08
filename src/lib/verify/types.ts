/**
 * Types for Remedy's photo verification engine (plan section 7.2).
 * The model reports what it sees; plain code makes every decision, computes every amount and picks every route.
 */

/** Actions a proof rule can ask the owner to take (plan section 7.1). */
export const PROOF_ACTIONS = ["cut_cord", "cut_in_half", "write_recalled", "remove_part", "puncture", "disassemble", "other"] as const;
export type ProofAction = (typeof PROOF_ACTIONS)[number];

/** What the photo must show (plan section 7.1). */
export const MUST_SHOW = ["whole_product", "label", "model_number", "serial_or_lot", "date_code", "cut_or_damage", "marking"] as const;
export type MustShow = (typeof MUST_SHOW)[number];

/**
 * The parts of a proof rule the verifier reads. Structurally compatible with the full ProofRule schema in plan 7.1,
 * so the data builder's rule can be passed in as it is.
 */
export type VerifyProofRule = {
  photo_required?: boolean;
  actions: readonly ProofAction[];
  /** For write_recalled: the exact word to write. Defaults to "RECALLED". */
  marker_text?: string | null;
  must_show: readonly MustShow[];
  remedy?: string;
  refund_amount_text?: string | null;
  explanation?: { plain: string; technical: string };
  /** Short owner steps, when the extractor wrote them. */
  steps?: readonly string[];
  /** How many photos the remedy asks for (src/lib/recall/photo-count.ts, from the remedy text); 1 when unset. */
  photo_count?: number;
  /** What each photo should show, in order, when the remedy says so. */
  photo_shows?: readonly string[];
};

/** An official image. `data` skips the download when the bytes are already at hand. */
export type RecallImage = { url: string; caption?: string | null; data?: Buffer | Uint8Array };

/** A lot, serial or date-code range named in the recall. Dates use YYYY-MM when the recall gives months. */
export type IdentifierRange = { kind: "lot" | "date_code" | "serial"; from: string; to: string; source?: string };

export type VerifyRecall = {
  /** CPSC recall number, for example "27056". */
  number: string;
  title: string;
  description?: string | null;
  remedyText?: string | null;
  products: { name: string; model?: string | null; description?: string | null; type?: string | null; units?: number | string | null }[];
  images: RecallImage[];
  /** Model numbers known for this recall. When absent they are read from the title, description and products. */
  models?: string[];
  /** Lot, serial or date ranges. When absent they are read from the description. */
  ranges?: IdentifierRange[];
  /** Units recalled in the US, as a number or as CPSC writes it ("About 11,000"). */
  units?: number | string | null;
};

/** PayPal-style money. */
export type Money = { value: string; currency: string };

export type PriorRefundResult = {
  /** The capture already has a refund. */
  refunded: boolean;
  /** An open dispute exists on the capture. */
  disputed?: boolean;
  plain?: string;
  technical?: string;
};
/** Supplied by the payments builder: looks up refunds on a capture and disputes on its transaction. */
export type PriorRefundCheck = (captureId: string) => Promise<PriorRefundResult>;

export type ClaimContext = {
  /** Earlier claims on this recall by the same payee (email or phone), not counting this one. */
  payeeClaimCount?: number;
  /** Units this payee bought. Defaults to 1. */
  unitsPurchased?: number;
  /** Claims so far on this recall from everyone, not counting this one. */
  recallClaimCount?: number;
  /** Overrides the recall's own unit count. */
  recallUnits?: number | null;
  /** The firm's refund for this product or model. */
  firmAmount?: Money | null;
  /** The firm's auto-approve cap per claim. */
  autoCap?: Money | null;
  /** A PayPal purchase matched to this owner. */
  linkedCapture?: { id: string; amount: Money; capturedAt?: string | null } | null;
  hasPriorRefund?: PriorRefundCheck;
  /** Used in plain copy: "A person at Brightline Home will take a look." */
  firmName?: string;
};

/** A stored perceptual hash: an earlier claim photo, or an official image of a recall. */
export type HashRef = { ref: string; dhash: string; caption?: string | null };

export type CheckId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
export const CHECK_IDS: readonly CheckId[] = ["C1", "C2", "C3", "C4", "C5", "C6"];

/**
 * pass: confirmed. fail: confirmed not met. unclear: the evidence does not settle it.
 * skipped: not run because an earlier step decided. unavailable: needs vision and no vision was available.
 */
export type CheckStatus = "pass" | "fail" | "unclear" | "skipped" | "unavailable";

export type CheckResult = {
  id: CheckId;
  name: string;
  pass: boolean;
  status: CheckStatus;
  score?: number;
  reason_plain: string;
  reason_technical: string;
  evidence?: Record<string, unknown>;
};

export type Checks = Record<CheckId, CheckResult>;

export type Decision = "verified" | "retake" | "firm_review";

export type QualityIssue = "blurry" | "dark" | "bright" | "small";
export type QualityReport = {
  ok: boolean;
  issues: QualityIssue[];
  metrics: { width: number; height: number; sharpness: number; laplacianVariance: number; meanLuma: number; p95Luma: number; p05Luma: number };
};

export type Guidance = { plain: string; steps: string[]; technical: string };

export type Amount = { value: string; currency: string; cents: number; source: "firm" | "capture" };

export type Timings = {
  decode_ms: number;
  official_ms: number;
  /** Comparing the photo's eight hash orientations with this recall's pictures, earlier claims and every recall's catalog (to 0.1 ms). */
  match_ms?: number;
  vision_ms: number;
  checks_ms: number;
  reviewers_ms: number;
  total_ms: number;
};
