/** Small pure formatters for the owner's pages. */

/** The six checks in the owner's words, in order (docs/how-it-works.md, "How it works"). */
export const CHECK_ORDER: { id: "C1" | "C2" | "C3" | "C4" | "C5" | "C6"; name: string }[] = [
  { id: "C1", name: "Right product" },
  { id: "C2", name: "Made safe" },
  { id: "C3", name: "Your own photo" },
  { id: "C4", name: "Within the recall" },
  { id: "C5", name: "Claim limits" },
  { id: "C6", name: "Not already refunded" },
];

export const money = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : `$${Number(v).toFixed(2)}`);

/** "usually within 2 days" from the firm's review hours. */
export function reviewWindow(hours: number): string {
  if (hours <= 24) return `usually within ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `usually within ${days} ${days === 1 ? "day" : "days"}`;
}

/** "Nov 5, 2026": a calendar date ("2026-10-29") as written, a moment in US Pacific time. */
export const day = (iso: string | null | undefined) =>
  iso
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", {
        timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? "UTC" : "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

/** "Nov 5, 2026, 1:04 PM" in US Pacific time. */
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** Seconds with one decimal, for the elapsed timer: "4.2 s". */
export const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

/**
 * The word beside each check. `reviewersAgreed`: the claim was verified by the two AI reviewers agreeing, so an unclear
 * check was settled by them, not left for a person.
 */
export function checkWord(status: string, opts: { reviewersAgreed?: boolean } = {}): { word: string; tone: "positive" | "attention" | "info" | "neutral" } {
  if (status === "unclear" && opts.reviewersAgreed) return { word: "Confirmed by two reviewers", tone: "positive" };
  switch (status) {
    case "pass":
      return { word: "Passed", tone: "positive" };
    case "fail":
      return { word: "Needs a change", tone: "attention" };
    case "unclear":
      return { word: "A person will look", tone: "info" };
    case "unavailable":
      return { word: "A person will look", tone: "neutral" };
    default:
      return { word: "Not checked", tone: "neutral" };
  }
}

/** The owner's words for where the money went. */
/**
 * An unsure check the two AI reviewers then settled: one state, said plainly, with the photo check's own score and
 * reason kept for a closer look. No threshold changes; this is how the outcome reads.
 */
export const settledLine = "Two AI reviewers looked closer and confirmed it, each citing what it saw in the photo.";
export const scoreLine = (score: number | null, reason: string) =>
  `${score !== null ? `The photo check scored ${score.toFixed(2)}, under the 0.85 pass mark, and said: ` : "The photo check said: "}“${reason}”`;

export function payeeWords(p: { type: "email" | "phone" | "venmo"; masked: string } | null) {
  if (!p) return "your PayPal account";
  return p.type === "venmo" ? `Venmo (${p.masked})` : `your PayPal account (${p.masked})`;
}
