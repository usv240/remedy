import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAll, normalizeRecall } from "@/lib/recall/ingest";
import { computeStats } from "@/lib/recall/stats";
import type { RawCpscRecall } from "@/lib/recall/types";

const snapshot = JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "raw", "cpsc-recalls-2026-11-01.json"), "utf8")) as RawCpscRecall[];

describe("published numbers (research/validation_recalls.md, 2026-11-01 snapshot)", () => {
  const s = computeStats(normalizeAll(snapshot));
  it("reproduces the headline photo-refund numbers exactly", () => {
    expect(s.recalls.count).toBe(1227);
    expect(s.range).toEqual({ from: "2024-01-04", to: "2026-10-29" });
    expect(s.all.photo.count).toBe(614);
    expect(s.all.photoRefund.count).toBe(523);
    expect(s.all.photoRefund.share).toBe(42.6);
    expect(s.photoRefund.email.count).toBe(496);
    expect(s.photoRefund.webmail.count).toBe(269);
    expect(s.all.paypalOrVenmo.count).toBe(0);
  });
  it("reproduces photo refunds by year", () => {
    expect(s.byYear["2024"].photoRefund).toBe(71);
    expect(s.byYear["2025"].photoRefund).toBe(172);
    expect(s.byYear["2026"].photoRefund).toBe(280);
  });
  it("reproduces Finding 1", () => {
    expect(s.all.refund.count).toBe(772);
    expect(s.all.soldOnline.count).toBe(980);
    expect(s.all.madeInChina.count).toBe(883);
    expect(s.all.recallVendor.count).toBe(46);
  });
  it("units: one recall with no number (\"Millions\") is left out, one fewer than published; shares round the same", () => {
    expect(s.all.under50k.count).toBe(993); // published 994
    expect(s.all.under10k.count).toBe(720); // published 721
    expect(Math.round(s.all.under50k.share!)).toBe(81);
    expect(Math.round(s.all.under10k.share!)).toBe(59);
  });
});

describe("normalizeRecall", () => {
  const raw = snapshot.find((r) => r.RecallNumber === "27045")!;
  const r = normalizeRecall(raw);
  it("keeps the shape the app's loader reads", () => {
    expect(Object.keys(r)).toEqual(
      expect.arrayContaining(["number", "title", "date", "units", "hazard", "remedyText", "remedies", "products", "images", "retailers", "manufacturers", "consumerContact", "url", "photoRefund", "flags"]),
    );
    expect(r.number).toBe("27045");
    expect(r.date).toBe("2026-10-29");
    expect(r.units).toBe(300);
    expect(r.photoRefund).toBe(true);
    expect(r.flags.cut).toBe(true);
    expect(r.products[0]).toMatchObject({ type: "Nightwear", units: 300 });
    expect(r.images.length).toBeGreaterThan(0);
    expect(r.images[0].url).toMatch(/^https:\/\//);
    expect(r.emails).toContain("qzh.duaoproductrecall@outlook.com");
  });
  it("de-duplicates by recall number and sorts newest first", () => {
    const all = normalizeAll([...snapshot.slice(0, 5), ...snapshot.slice(0, 5)]);
    expect(all).toHaveLength(5);
    expect(all.map((x) => x.date)).toEqual([...all.map((x) => x.date)].sort().reverse());
  });
});
