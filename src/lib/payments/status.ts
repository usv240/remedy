import type { PaymentRoute, PaymentStatus } from "./types";

/**
 * PayPal's status words mapped to Remedy's payment statuses, with plain words for owners and firms. The words stay
 * neutral: a payment that has not landed yet is "waiting", never a problem with the person.
 */
export type StatusInfo = {
  status: PaymentStatus;
  /** Short label for a grid cell or a badge. */
  label: string;
  /** One plain sentence for the owner or the firm. */
  plain: string;
  /** No further change is expected from PayPal on its own. */
  final: boolean;
  /** The firm's plan should add a follow-up (a re-notice task). */
  followUp: boolean;
};

const INFO: Record<PaymentStatus, Omit<StatusInfo, "status">> = {
  sending: { label: "On its way", plain: "On its way. PayPal is sending it now.", final: false, followUp: false },
  paid: { label: "Paid", plain: "Paid. The money is in their account.", final: true, followUp: false },
  unclaimed: {
    label: "Waiting to be accepted",
    plain: "Sent. PayPal emailed a link to accept it, and we will send a friendly reminder.",
    final: false,
    followUp: true,
  },
  returned: {
    label: "Returned to the firm",
    plain: "Not accepted within 30 days, so PayPal returned it to the firm. We will reach out again with another way to get paid.",
    final: true,
    followUp: true,
  },
  failed: { label: "Not sent", plain: "PayPal could not send this one. Check the email or phone number and try again.", final: true, followUp: false },
  blocked: {
    label: "Needs another way",
    plain: "PayPal could not send to this account. A person at the firm will find another way to pay.",
    final: true,
    followUp: false,
  },
  on_hold: { label: "In review at PayPal", plain: "PayPal is doing a routine review. This usually clears on its own.", final: false, followUp: false },
  canceled: { label: "Canceled", plain: "Canceled before it was accepted. The money is back with the firm.", final: true, followUp: false },
  reversed: { label: "Reversed", plain: "PayPal reversed this payment. A person at the firm will follow up.", final: true, followUp: false },
};

/** The plain sentence for a status, worded for the route (a refund lands on the original payment). */
export function describeStatus(status: PaymentStatus, route: PaymentRoute = "payout"): StatusInfo {
  const base = { status, ...INFO[status] };
  if (status === "paid" && route === "refund") return { ...base, label: "Refunded", plain: "Refunded to the account they paid with." };
  if (status === "paid" && route === "replacement") return { ...base, label: "Replacement paid", plain: "Replacement paid. The retailer will ship it." };
  return base;
}

/** Payouts item `transaction_status` (and the webhook suffix, such as SUCCEEDED or CANCELED) to Remedy's status. */
export function payoutItemStatus(paypal: string | null | undefined): PaymentStatus {
  switch ((paypal ?? "").toUpperCase()) {
    case "SUCCESS":
    case "SUCCEEDED":
      return "paid";
    case "UNCLAIMED":
      return "unclaimed";
    case "RETURNED":
      return "returned";
    case "FAILED":
    case "DENIED":
      return "failed";
    case "BLOCKED":
      return "blocked";
    case "ONHOLD":
    case "HELD":
      return "on_hold";
    case "CANCELED":
    case "CANCELLED":
      return "canceled";
    case "REFUNDED":
    case "REVERSED":
      return "reversed";
    case "PENDING":
    case "NEW":
    case "PROCESSING":
    default:
      return "sending";
  }
}

/** Refund (`/v2/payments/refunds`) status to Remedy's status. */
export function refundStatus(paypal: string | null | undefined): PaymentStatus {
  switch ((paypal ?? "").toUpperCase()) {
    case "COMPLETED":
      return "paid";
    case "FAILED":
      return "failed";
    case "CANCELLED":
    case "CANCELED":
      return "canceled";
    default:
      return "sending";
  }
}

/** Order capture status (replacement orders) to Remedy's status. */
export function captureStatus(paypal: string | null | undefined): PaymentStatus {
  switch ((paypal ?? "").toUpperCase()) {
    case "COMPLETED":
      return "paid";
    case "DECLINED":
    case "FAILED":
      return "failed";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "reversed";
    default:
      return "sending";
  }
}

/** Statuses a reconcile pass should keep asking PayPal about. */
export const OPEN_STATUSES: PaymentStatus[] = ["sending", "unclaimed", "on_hold"];

/** Plain words for PayPal issue codes the engine can meet. Unknown codes get a general sentence. */
const ISSUE: Record<string, string> = {
  INSUFFICIENT_FUNDS: "The firm's sandbox balance is too low for this payment right now.",
  RECEIVER_UNREGISTERED: "There is no PayPal account for this email or phone yet. PayPal sent a link to accept the money.",
  ITEM_INCORRECT_STATUS: "Only a payment that is still waiting to be accepted can be canceled.",
  ITEM_ALREADY_CANCELLED: "This payment was already canceled.",
  BATCH_NOT_COMPLETED: "PayPal is still finishing this batch. Please try canceling again in a few minutes.",
  CAPTURE_FULLY_REFUNDED: "This purchase was already refunded in full.",
  REFUND_AMOUNT_EXCEEDED: "The refund is more than what is left on this purchase.",
  REFUND_TIME_LIMIT_EXCEEDED: "This purchase is older than 180 days, so PayPal cannot refund it. A payout is used instead.",
  INSTRUMENT_DECLINED: "That payment method was declined, so nothing was charged.",
  ORDER_NOT_APPROVED: "PayPal has not approved this purchase yet, so nothing was charged.",
  ORDER_ALREADY_CAPTURED: "This purchase is already complete.",
  VALIDATION_ERROR: "PayPal could not accept these payment details.",
  DUPLICATE_REQUEST_ID: "This payment was already sent once.",
  TIMEOUT: "PayPal did not answer in time. The next try asks PayPal about this same payment first, so it is never sent twice.",
};

export function plainIssue(issue: string | null | undefined) {
  return (issue && ISSUE[issue]) || "PayPal could not complete this step. Please try again.";
}
