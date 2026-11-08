/**
 * Info entries for the firm console, beside each rule or decision. Kept here (not in content/info.json, which the shell
 * owns) and passed to <Info entry>; the lead can move them into info.json under the same ids.
 */
import type { InfoEntry } from "@/components/Info";

export const FIRM_INFO = {
  "firm.completion": {
    title: "Completion",
    what: "Units verified made safe, out of every unit the recall covers.",
    why: "It is the share of recalled products the CPSC counts as corrected, so it shows how far the recall has come.",
    technical: "Sum of claim.units_claimed on claims verified by the checks or approved by a reviewer, over recall.units from the recall's data (the CPSC's for a real recall).",
  },
  "firm.needs-review": {
    title: "Needs review",
    what: "Claims the checks could not settle on their own, and payments PayPal could not send.",
    why: "A person at the firm makes these calls, so every refund still goes to a real owner.",
    technical: "claim.decision = firm_review with no review outcome yet, plus payments in status failed or blocked.",
  },
  "firm.next-report": {
    title: "Next CPSC report",
    what: "The monthly progress report the firm files with the CPSC, and when it is due.",
    why: "The CPSC's progress report form asks for the completed form by the first of each month.",
    technical: "CPSC Monthly Progress Report for Corrective Action Plans (updated 10/2015): report 1 covers the announcement day to the end of that month.",
    learnMore: { label: "Open the report", href: "/firm/reports" },
  },
  "firm.unclaimed": {
    title: "Waiting to be accepted",
    what: "Payouts PayPal sent that the owner has not accepted yet.",
    why: "PayPal emails the owner a link to accept the money. If nobody accepts it within 30 days, it comes back to the firm, so Remedy plans a friendly reminder.",
    technical: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED: payment.status unclaimed. Each one adds a Re-notice task to the plan (src/lib/payments/events.ts).",
  },
  "firm.queue": {
    title: "Claims queue",
    what: "Every claim, with its photo, the six checks, the decision and where the payment stands.",
    why: "One place to see what is done, what needs a person, and what is ready to pay.",
    technical: "AG Grid 36.3: Community modules, plus Enterprise set filters, column menu and status bar when a valid license key is set. Rows from claim, payment_plan and payment; payout status updates live over Server-Sent Events.",
  },
  "firm.approve-pay": {
    title: "Approve and pay",
    what: "Pays every verified claim you chose, in one PayPal Payouts batch.",
    why: "Verified claims passed all six checks, so a person approves the batch and PayPal sends each refund.",
    technical: "planPayment, then approvePlan in the reviewer's name, then payClaims: one POST /v1/payments/payouts with one item per claim (sender_item_id is the claim). Idempotent per claim.",
  },
  "firm.checks": {
    title: "The six checks",
    what: "Right product, made safe, their own photo, within the recall, claim limits, and not already refunded.",
    why: "Each check keeps the refund pool for real owners of the recalled product.",
    technical: "C1 to C6 from the verification engine (src/lib/verify). C1, C2 and C4 come from one Claude vision call; C3 is a perceptual hash; C5 and C6 are code and PayPal lookups.",
  },
  "firm.two-reviewers": {
    title: "Two reviewers",
    what: "When the checks are unsure, two AI reviewers look at the photo separately, and a referee in code compares them.",
    why: "Two independent looks catch more than one. When they disagree, a person at the firm decides.",
    technical: "Two Claude calls with different instructions (one reads the product, one reads the safety step); the referee is deterministic code (src/lib/verify/reviewers.ts).",
  },
  "firm.plan-route": {
    title: "How the refund is paid",
    what: "A refund to the original PayPal payment when they bought it with PayPal in the last 180 days; otherwise a PayPal payout to their email or phone.",
    why: "PayPal accepts refunds on a payment for 180 days, and money back to the same payment is the simplest for everyone.",
    technical: "chooseRoute in src/lib/payments/router.ts: linked capture within 180 days and not refunded or disputed, then refund; else payout.",
  },
  "firm.gantt": {
    title: "Corrective-action plan",
    what: "The recall's plan: notices, payout batches, follow-ups and the CPSC reports, with what each one waits on.",
    why: "It updates itself. When a payout waits to be accepted, a friendly re-notice appears here without anyone adding it.",
    technical: "Bryntum Gantt 7.3.8 (trial). Tasks from plan_task; dependencies are finish to start. New rows arrive over Server-Sent Events from /api/firm/live.",
  },
  "firm.move-task": {
    title: "Move a task",
    what: "Change when a task starts and how long it runs, without dragging.",
    why: "Dragging is one way; this form does the same thing with a keyboard or a screen reader.",
    technical: "POST /api/firm/plan. Only plans move; records of what happened (the announcement, a payout batch) keep their dates.",
  },
  "firm.scheduler": {
    title: "Review schedule",
    what: "Who at the firm has each review, and when the answer is due.",
    why: "Owners are told to expect an answer within the firm's response time, 48 hours here.",
    technical: "Bryntum Scheduler (from the Gantt package): reviewers as resources, review cases as events from claim.created_at to the due time or reviewed_at.",
  },
  "firm.report": {
    title: "Monthly progress report",
    what: "The numbers the CPSC asks for each month, counted from the claims and payments, with a short summary.",
    why: "It saves the firm hours each month, and every figure comes straight from the records.",
    technical: "Counted in SQL (src/lib/firm/report-data.ts). Field names follow the CPSC Monthly Progress Report form (updated 10/2015).",
    learnMore: { label: "The CPSC's form", href: "https://www.cpsc.gov/s3fs-public/MonthlyProgressReport-ElectronicForm_0.pdf" },
  },
  "firm.narrative": {
    title: "The summary paragraph",
    what: "A few plain sentences that say what the numbers show.",
    why: "Claude writes it from the numbers, and Remedy checks that every figure in it is one of the report's own.",
    technical: "Claude Haiku 5.5, effort low, written once a month and stored. Any figure not in the report sends it back to the plain template.",
  },
  "firm.buyers": {
    title: "Find buyers",
    what: "Find the people who bought the recalled product, from a sales file or from PayPal, and download a notice for each, with a personal claim link, to send from your own mail tool.",
    why: "A direct notice reaches the people who own the product, which is what makes a recall work.",
    technical: "Sales lines match the recalled product by shared words or an exact SKU (matchItem). PayPal Transaction Search reads 31-day windows.",
  },
  "firm.refund-original": {
    title: "Refund to original payment",
    what: "They paid with PayPal in the last 180 days, so their refund goes back to that payment once their photo checks out.",
    why: "It is the simplest refund for the owner, and PayPal allows it for 180 days after the purchase.",
    technical: "POST /v2/payments/captures/{capture_id}/refund, with the sale's capture id.",
  },
  "firm.scan": {
    title: "Scan a catalog",
    what: "Paste or upload the products you sell. Each row comes back as a photo-refund recall, another recall, clear, or unknown.",
    why: "A retailer or marketplace finds every recalled listing in one pass, and sees which ones Remedy can refund on a photo.",
    technical: "POST /api/v1/scan: the recall search finds candidates per row; a stated model or UPC in the recall's own list settles it; otherwise a keyword score, and Claude Opus 5.5 reads only the ambiguous rows in batches of 20, inside the daily AI budget.",
    learnMore: { label: "The scan API", href: "/developers/docs#scan" },
  },
} satisfies Record<string, InfoEntry>;

export type FirmInfoId = keyof typeof FIRM_INFO;
