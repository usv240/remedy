/**
 * The recall notice a firm sends each matched buyer, and the file it downloads to send them. Remedy does not send
 * mail: it makes each buyer a personal claim link and the notice's text, and the firm sends them from its own mail
 * tool (a CSV it can import, one row per buyer). Pure and free of server imports, so the firm console builds the
 * download in the browser, where the buyer's full address comes from the firm's own sales file and never from Remedy's
 * server, which keeps contacts encrypted and returns them masked.
 */
import { recallLabel } from "@/lib/recall/label";

export type NoticeInput = { firmName: string; product: string; recallNumber: string; link: string; refundToOriginal: boolean };
export type NoticeEmail = { subject: string; paragraphs: string[]; link: string };

/** The email, as a subject and short paragraphs; the same words go in the CSV and the preview. */
export function noticeEmail(o: NoticeInput): NoticeEmail {
  // A sample product's name ends "(sample)"; the recall's label already says sample recall, so it is said once.
  const product = o.product.replace(/\s*\(sample\)\s*$/i, "");
  return {
    subject: `Safety recall: your ${product} (${recallLabel(o.recallNumber)})`,
    paragraphs: [
      `Your ${product} is part of a safety recall (${recallLabel(o.recallNumber)}). Please stop using it.`,
      `Make it safe the way the recall describes, take one photo, and send it with your personal link: ${o.link}`,
      o.refundToOriginal ? "You paid with PayPal, so your refund goes back to that same payment once your photo checks out." : "Your refund is sent to your PayPal or Venmo once your photo checks out.",
      `Thank you for keeping your home safe. The ${o.firmName} recall team.`,
    ],
    link: o.link,
  };
}

/** The notice as one line of plain text (the text message, and the body column in the CSV). */
export const noticeText = (o: NoticeInput) => noticeEmail(o).paragraphs.join(" ");

/** One notice as the firm console holds it after "Make the notices". */
export type NoticeRow = {
  saleId: number;
  /** The sales file's line and order id, when the buyer came from a file. */
  line: number | null;
  orderId: string | null;
  channel: "email" | "sms";
  /** The buyer's address for the firm's mail tool: from the firm's own file in the browser, or masked. */
  contact: string;
  link: string;
  subject: string;
  body: string;
  refundToOriginal: boolean;
};

export const NOTICE_COLUMNS = ["order_id", "channel", "to", "subject", "body", "claim_link", "refund_to_original_payment"] as const;

/** A CSV cell: quoted when it holds a comma, quote or line break; a leading = + - @ is kept as text in spreadsheets. */
export function csvCell(v: string | number | boolean | null): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The download: a header, then one row per notice ready to send. CRLF line ends, as mail tools expect from CSV. */
export function noticeCsv(rows: NoticeRow[]): string {
  const lines = [NOTICE_COLUMNS.join(",")];
  for (const r of rows) lines.push([r.orderId, r.channel, r.contact, r.subject, r.body, r.link, r.refundToOriginal ? "yes" : "no"].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** The file name: the recall and the day, so a second download does not overwrite the first. */
export const noticeFileName = (recallNumber: string, day: string) => `remedy-notices-${recallNumber.replace(/[^A-Za-z0-9-]/g, "")}-${day}.csv`;
