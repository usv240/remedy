import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { csvCell, NOTICE_COLUMNS, noticeCsv, noticeEmail, noticeFileName, noticeText, type NoticeRow } from "@/lib/firm/notices";

/** The notices a firm downloads for its own mail tool: Remedy makes them, the firm sends them. */
describe("recall notices for the firm's own mail tool", () => {
  const input = { firmName: "Brightline Home", product: "Brightline 65W laptop charger", recallNumber: "BH-2026-01", link: "https://x.test/claim/BH-2026-01?n=abc", refundToOriginal: true };

  it("the email names the recall in its subject, and the link and the refund route in its text", () => {
    const e = noticeEmail(input);
    expect(e.subject).toBe("Safety recall: your Brightline 65W laptop charger (sample recall BH-2026-01)");
    expect(e.paragraphs).toHaveLength(4);
    expect(e.paragraphs[1]).toContain(input.link);
    expect(e.paragraphs[2]).toContain("goes back to that same payment");
    expect(noticeEmail({ ...input, refundToOriginal: false }).paragraphs[2]).toContain("PayPal or Venmo");
    expect(noticeText(input)).toBe(e.paragraphs.join(" "));
    // "(sample)" once: the label already says sample recall.
    expect(noticeEmail({ ...input, product: "Brightline 65W laptop charger (sample)" }).subject).toBe("Safety recall: your Brightline 65W laptop charger (sample recall BH-2026-01)");
    // No dashes used as punctuation, no emojis.
    expect(noticeText(input)).not.toMatch(/[–—]|\p{Extended_Pictographic}/u);
  });

  it("the CSV has one row per notice, quotes what needs quoting, and reads back to the same values", () => {
    const rows: NoticeRow[] = [
      { saleId: 1, line: 2, orderId: "BLH-1001", channel: "email", contact: "jordan@example.com", link: input.link, subject: noticeEmail(input).subject, body: noticeText(input), refundToOriginal: true },
      { saleId: 2, line: 3, orderId: null, channel: "sms", contact: "(415) 555-0134", link: "https://x.test/claim/BH-2026-01?n=def", subject: "Safety recall, \"quoted\"", body: "Line one,\nline two", refundToOriginal: false },
    ];
    const csv = noticeCsv(rows);
    expect(csv.split("\r\n")[0]).toBe(NOTICE_COLUMNS.join(","));
    const back = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ order_id: "BLH-1001", channel: "email", to: "jordan@example.com", claim_link: input.link, refund_to_original_payment: "yes" });
    expect(back[1]).toMatchObject({ order_id: "", channel: "sms", to: "(415) 555-0134", subject: 'Safety recall, "quoted"', body: "Line one,\nline two", refund_to_original_payment: "no" });
  });

  it("a cell that a spreadsheet would run as a formula is kept as text", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1 415")).toBe("'+1 415");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell(null)).toBe("");
    expect(csvCell("plain")).toBe("plain");
  });

  it("the file is named for the recall and the day", () => {
    expect(noticeFileName("BH-2026-01", "2026-11-08")).toBe("remedy-notices-BH-2026-01-2026-11-08.csv");
    expect(noticeFileName("../x", "2026-11-08")).toBe("remedy-notices-x-2026-11-08.csv");
  });

  it("no page, route or component says a notice is sent or 'would send' when Remedy sends no mail", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|json)$/.test(f)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), "src"));
    files.push(path.join(process.cwd(), "content", "info.json"));
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/would send (?:a|the) (?:recall notice|retake)|logged as (?:&ldquo;|")would send|sends (?:each|them) a personal claim link|so the notice reaches the owner directly/);
    }
  });
});
