/**
 * The public shapes of the claims API (`/api/claims`, documented as `/api/v1/claims`). No runtime code, so client
 * components import these types freely. Nothing here carries personal data: a payee is only ever shown masked.
 */

export type CheckId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
export type CheckStatus = "pass" | "fail" | "unclear" | "skipped" | "unavailable";
export type Decision = "verified" | "retake" | "firm_review";
export type ClaimStatus = "checking" | "verified" | "retake" | "firm_review" | "approved" | "paid" | "unclaimed" | "closed";

export type CheckView = {
  id: CheckId;
  name: string;
  status: CheckStatus;
  pass: boolean;
  score: number | null;
  reason_plain: string;
  reason_technical: string;
};

export type GuidanceView = { plain: string; steps: string[]; technical: string };

export type ReviewView = {
  reviews: {
    reviewer: string;
    name: string;
    reads: string;
    answer: string;
    evidence: { check: string; seen: string; where: string }[];
    model_read?: string | null;
    marker_text_read?: string | null;
    reason: { plain: string; technical: string };
    confidence: number;
    counted: boolean;
    set_aside_reason: string | null;
  }[];
  referee: { decision: "verify" | "person"; agreed: boolean; summary: { plain: string; technical: string } };
  model: string | null;
  ms: number | null;
};

export type LinkView =
  | { status: "linked"; paid_at: string; amount: string; item: string; refundable_until: string; days_left: number }
  | { status: "not_found" | "already_claimed" | "too_old" | "not_this_recall"; message: string };

export type PaymentView = {
  route: "refund" | "payout" | "replacement";
  plan_status: string;
  amount: string;
  currency: "USD";
  reasons: { plain: string; technical: string };
  approval: { by: string; who: string; rule?: string | null; at: string } | null;
  status: string | null;
  status_label: string | null;
  status_plain: string | null;
  final: boolean;
  paypal_status: string | null;
  payee: { type: "email" | "phone" | "venmo"; masked: string } | null;
  ids: {
    payout_batch_id: string | null;
    payout_item_id: string | null;
    transaction_id: string | null;
    refund_id: string | null;
    order_id: string | null;
    capture_id: string | null;
    debug_id: string | null;
  };
  issue: string | null;
  replacement: { title: string; retailer: string; url: string | null } | null;
  updated_at: string | null;
};

export type ClaimView = {
  id: string;
  recall: { number: string; title: string; product: string };
  status: ClaimStatus;
  decision: Decision | "pending";
  decided_by: string | null;
  channel: string;
  created_at: string;
  decided_at: string | null;
  checks: CheckView[];
  guidance: GuidanceView | null;
  summary: { plain: string; technical: string } | null;
  amount: { value: string; currency: string; source: "firm" | "capture" | "demo" } | null;
  quality: { ok: boolean; issues: string[] } | null;
  timings: Record<string, number> | null;
  model: string | null;
  review: ReviewView | null;
  link: LinkView | null;
  payment: PaymentView | null;
  firm: { name: string; sample: true; review_hours: number; refund_source: "firm" | "demo" };
  photo_url: string | null;
  receipt_url: string;
  sandbox_label: string;
};

/** Server-sent events from `POST /api/claims` with `Accept: text/event-stream`. */
export type ClaimEvent =
  | { type: "claim"; id: string; recall: string }
  | { type: "stage"; stage: "stored" | "vision" | "reviewers"; state: "start" | "done"; ms?: number }
  | { type: "result"; claim: ClaimView }
  | { type: "error"; code: string; message: string };

/** `data` of `POST /api/claims/{id}/pay`. */
export type PayView = { kind: string; plain: string; claim: ClaimView };

/** A safe replacement option from Channel3, checked against the recall list. */
export type ReplacementOption = {
  id: string;
  title: string;
  brand: string | null;
  image: string | null;
  image_alt: string | null;
  price: string;
  retailer: string | null;
  url: string | null;
  recall_check: { clear: boolean; plain: string; technical: string };
};
