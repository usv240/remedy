/**
 * Shapes the firm console's pages, API routes and client components share. Type-only and client safe.
 */
import type { CheckId } from "@/lib/verify/types";
import type { CheckWord, ReviewersWord } from "./checks";

export type Decision = "pending" | "verified" | "retake" | "firm_review";
export type ClaimStatus = "checking" | "verified" | "retake" | "firm_review" | "approved" | "paid" | "unclaimed" | "closed";
/** Remedy's payment words (src/lib/payments/types.ts PaymentStatus). */
export type PayStatus = "sending" | "paid" | "unclaimed" | "returned" | "failed" | "blocked" | "on_hold" | "canceled" | "reversed";

export type PayoutCell = {
  status: PayStatus | null;
  /** "Paid", "Waiting to be accepted", "Not paid yet". */
  label: string;
  route: "refund" | "payout" | "replacement" | null;
  /** Sample history: the row was seeded, no money moved. */
  sample: boolean;
  paidAt: string | null;
  batchId: string | null;
  itemId: string | null;
};

export type QueueRow = {
  id: string;
  recallNumber: string;
  recallShort: string;
  /** /api/firm/claims/{id}/photo when a photo is stored. Sample claims have none and show a drawing. */
  photoUrl: string | null;
  /** Why a real claim has no photo: it showed a person (deleted at once) or its 90 days had passed. */
  photoRemoved: "person" | "retention" | null;
  /** Masked: "j•••@example.com". */
  claimant: string;
  payeeType: "email" | "phone" | "venmo" | null;
  checks: Record<CheckId, CheckWord>;
  confidence: number | null;
  /** What the two reviewers did: agreed, disagreed, not settled, or not needed (reviewersOutcome in ./checks). */
  reviewers: ReviewersWord;
  decision: Decision;
  /** Where the claim stands for the firm, in plain words: "Ready to pay", "Needs review", "Paid". */
  stage: Stage;
  reviewOutcome: "approved" | "retake" | "declined" | null;
  amountCents: number | null;
  payout: PayoutCell;
  channel: string;
  submittedAt: string;
  sample: boolean;
  /** Verified (or approved) with an amount and a payee, and no payment started: bulk "Approve and pay" can take it. */
  payable: boolean;
};

export type Stage = "needs_review" | "ready" | "sending" | "paid" | "unclaimed" | "retake" | "declined" | "checking" | "closed";

/**
 * The sample reviewer. Signing in to the sample console is one click that sets this name; there is no real account
 * (FIRM_INFO["firm.sign-in"]). Approvals and retake requests are recorded in the name.
 */
export const SAMPLE_REVIEWER = "Ana";

export const STAGE_LABEL: Record<Stage, string> = {
  needs_review: "Needs review",
  ready: "Ready to pay",
  sending: "Sending",
  paid: "Paid",
  unclaimed: "Waiting to be accepted",
  retake: "New photo asked",
  declined: "Declined",
  checking: "Checking",
  closed: "Closed",
};

export const STAGE_TONE: Record<Stage, "positive" | "attention" | "info" | "neutral" | "paid"> = {
  needs_review: "attention",
  ready: "info",
  sending: "info",
  paid: "paid",
  unclaimed: "attention",
  retake: "neutral",
  declined: "neutral",
  checking: "neutral",
  closed: "neutral",
};

export type Review = {
  reviews: {
    reviewer: string;
    name: string;
    reads: string;
    answer: string;
    evidence?: unknown;
    model_read?: string | null;
    marker_text_read?: string | null;
    reason: { plain: string; technical: string };
    confidence: number;
    counted: boolean;
    set_aside_reason: string | null;
  }[];
  referee: { decision: string; agreed: boolean; summary: { plain: string; technical: string } | string };
  model: string | null;
  ms: number | null;
};

export type ClaimDetail = {
  row: QueueRow;
  recall: { number: string; title: string; image: string | null; units: number | null; url: string };
  rule: { steps: string[]; actions: string[]; mustShow: string[]; plain: string | null; source: string | null } | null;
  checks: { id: CheckId; name: string; status: CheckWord; plain: string; technical: string; score: number | null }[];
  review: Review | null;
  plan: {
    exists: boolean;
    route: "refund" | "payout" | "replacement" | null;
    amountCents: number | null;
    payee: string | null;
    approval: string | null;
    status: string | null;
    plain: string;
    technical: string;
  };
  payment: { status: PayStatus | null; plain: string | null; batchId: string | null; itemId: string | null; paypalStatus: string | null; issue: string | null; sample: boolean } | null;
  /** The verifier's own answer (claim.result): who decided, its summary, what would help, the model and the time. */
  verdict: {
    decidedBy: string | null;
    summary: { plain: string; technical: string } | null;
    guidance: { plain: string; steps: string[]; technical: string } | null;
    model: string | null;
    totalMs: number | null;
    quality: { ok: boolean; issues: string[] } | null;
  } | null;
  /** Shown in the drawer: what this photo or claim is (sample history, a recorded run). */
  note: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type HomeSummary = {
  firm: { name: string; isSample: boolean };
  recall: { number: string; title: string; short: string; units: number | null; unitsText: string; announced: string; daysSince: number; image: string | null };
  claimsTotal: number;
  claimsVerified: number;
  unitsCorrected: number;
  refundsPaid: { count: number; cents: number };
  /** The verified claims on the main recall by where their latest payment stands: the reconciliation line (./kpis). */
  verifiedBy: { paid: number; waiting: number; unpaid: number; other: number };
  completionPercent: number;
  needsReview: number;
  readyToPay: number;
  nextReport: { index: number; month: string; dueOn: string; daysLeft: number } | null;
  /** The oldest payouts waiting to be accepted, at most UNCLAIMED_SHOWN of them. */
  unclaimed: { claimId: string; claimant: string; amountCents: number; since: string; sample: boolean; status: PayStatus }[];
  /** How many claims wait for their payout to be accepted, counted on its own: the queue's "Waiting to be accepted" view. */
  unclaimedCount: number;
  sampleClaims: number;
  /** Every claim in this console, across its recalls: what the claims queue lists. */
  claimsAllRecalls: { claims: number; recalls: number };
  otherRecalls: { number: string; short: string; claims: number }[];
};
