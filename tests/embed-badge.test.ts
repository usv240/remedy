import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { badgeData, badgeHtml, badgeScript, esc, remedyLine } from "@/lib/embed/badge";
import { recallByNumber } from "@/lib/api/recall-data";
import { latestStoredDate, runDaily } from "@/lib/recall/daily";
import { loadRecalls } from "@/lib/recall/search";

const saved = { ...process.env };
beforeEach(() => {
  for (const k of ["ELASTIC_URL", "ELASTIC_API_KEY", "DATABASE_URL", "ANTHROPIC_API_KEY"]) delete process.env[k];
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("the recall badge", () => {
  it("says the one-line remedy and refund for a photo-refund recall, with the claim link", async () => {
    const d = await badgeData({ recall: "27056" });
    expect(d.found).toBe(true);
    expect(d.recall?.short).toBe("HAIARA Power Banks");
    expect(d.line).toMatch(/Write RECALLED on it, then send one photo: full refund\./);
    expect(d.claimPath).toBe("/claim/27056");
    const html = badgeHtml(d, "https://remedy.example/");
    expect(html).toContain('href="https://remedy.example/claim/27056"');
    expect(html).toContain("Get your refund");
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("Recall data: US Consumer Product Safety Commission");
  });

  it("finds a recall from words, labels a sample recall, and says when nothing matches", async () => {
    const q = await badgeData({ q: "HAIARA power bank" });
    expect(q.recall?.number).toBe("27056");
    const s = await badgeData({ recall: "bh-2026-01" });
    expect(s.recall?.sample).toBe(true);
    expect(badgeHtml(s, "http://localhost:3400")).toContain("Sample recall; the firm is fictional.");
    const none = await badgeData({ recall: "99999" });
    expect(none.found).toBe(false);
    expect(badgeHtml(none, "http://localhost:3400")).toContain("No recall found");
  });

  it("escapes every input, so a badge can never carry script into a host page", async () => {
    expect(esc(`<script>alert("x")</script>'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;");
    const d = await badgeData({ q: "<img src=x onerror=alert(1)>" });
    const html = badgeHtml(d, "https://remedy.example");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=");
  });

  it("a recall with another remedy gets a See the recall link, not a refund button", () => {
    const r = loadRecalls().find((x) => !x.photoRefund && x.remedies.includes("Repair"))!;
    const { line, refund } = remedyLine(r);
    expect(line).toMatch(/^Stop using it\./);
    expect(refund).toContain("Repair");
    const d = { found: true as const, recall: { number: r.number, title: r.title, short: r.title, date: r.date, photoRefund: false, sample: false }, line, refund, claimPath: `/recalls/${r.number}` };
    expect(badgeHtml(d, "https://remedy.example")).toContain("See the recall");
  });

  it("the one-script embed points the iframe at this server", () => {
    const js = badgeScript("https://remedy.example/");
    expect(js).toContain('"https://remedy.example/api/embed/badge?"');
    expect(js).toContain("document.currentScript");
    expect(js).not.toContain("remedy.example//");
  });
});

describe("the daily ingest", () => {
  it("without a database, the latest stored date is the newest recall in the committed file", async () => {
    expect(await latestStoredDate()).toBe(loadRecalls()[0].date);
  });

  it("a dry run plans the new recalls from the CPSC feed, writes nothing and calls no model", async () => {
    const known = recallByNumber("27056")!;
    const fresh = { RecallID: 1, RecallNumber: "99901", RecallDate: "2026-11-06T00:00:00", Title: "Acme Hair Dryers Recalled Due to Shock Hazard", URL: "https://www.cpsc.gov/Recalls/2027/acme", Products: [{ Name: "Acme hair dryers", Model: "HD-1", Type: "", NumberOfUnits: "About 500" }], Hazards: [{ Name: "Shock." }], Remedies: [{ Name: "Consumers should cut the cord and email a photo for a full refund." }], RemedyOptions: [{ Option: "Refund" }], Images: [], ConsumerContact: "Acme at recall@acme.example" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify([{ RecallNumber: known.number, RecallDate: `${known.date}T00:00:00`, Title: known.title }, fresh]), { headers: { "content-type": "application/json" } }));
    const r = await runDaily({ dry: true, since: "2026-11-05" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("RecallDateStart=2026-11-05");
    expect(r.dry).toBe(true);
    expect(r.fetched).toBe(2);
    expect(r.newRecalls).toEqual([{ number: "99901", date: "2026-11-06", title: fresh.Title, photoRefund: true, category: expect.any(String) }]);
    expect(r.rules).toEqual({ claude: 0, baseline: 0, skipped: 0 });
    expect(r.usd).toBe(0);
    expect(r.note).toMatch(/Dry run: 1 new recalls would be stored/);
  });

  it("a real run without a database says so instead of writing nowhere", async () => {
    await expect(runDaily({ since: "2026-11-06" })).rejects.toThrow(/DATABASE_URL/);
  });
});
