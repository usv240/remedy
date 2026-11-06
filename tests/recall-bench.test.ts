import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crossCheck, fieldCorrect, scoreVariant, type LabelDraft, type LabelRecord } from "@/lib/recall/bench";
import { extractBaseline } from "@/lib/recall/proof-rule";
import { allocate, benchmarkSample, rng, stratifiedSample } from "@/lib/recall/sample";
import type { RecallsFile } from "@/lib/recall/types";

const recalls = (JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "recalls.json"), "utf8")) as RecallsFile).recalls;
const rec = recalls.find((r) => r.number === "27056")!;

describe("seeded stratified sample", () => {
  it("the PRNG repeats for a seed", () => {
    const a = rng(7);
    const b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("allocation adds up and gives every stratum at least one", () => {
    const a = allocate({ x: 50, y: 30, z: 1 }, 10);
    expect(Object.values(a).reduce((s, v) => s + v, 0)).toBe(10);
    expect(a.z).toBe(1);
  });
  it("never takes more than a stratum holds", () => {
    const s = stratifiedSample([1, 2, 3, 4, 5], (n) => (n < 2 ? "small" : "big"), 4, 1);
    expect(s.picked).toHaveLength(4);
    expect(new Set(s.picked).size).toBe(4);
  });
  it("the benchmark sample is 100 photo-refund plus 30 non-photo, and repeats", () => {
    const a = benchmarkSample(recalls);
    const b = benchmarkSample(recalls);
    expect(a.photo.picked).toHaveLength(100);
    expect(a.other.picked).toHaveLength(30);
    expect(a.photo.picked.every((r) => r.photoRefund)).toBe(true);
    expect(a.other.picked.every((r) => !r.flags.photo)).toBe(true);
    expect(a.photo.picked.map((r) => r.number)).toEqual(b.photo.picked.map((r) => r.number));
  });
  it("sample.json matches the seeded draw", () => {
    const file = JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "benchmark", "sample.json"), "utf8")) as { items: { number: string }[] };
    const a = benchmarkSample(recalls);
    expect(file.items.map((i) => i.number)).toEqual([...a.photo.picked, ...a.other.picked].map((r) => r.number));
  });
});

const label = (over: Partial<LabelDraft> = {}): LabelDraft => ({
  photo_required: true,
  actions: ["write_recalled"],
  marker_text: "recalled",
  must_show: ["whole_product", "marking"],
  remedy: "full_refund",
  refund_amount: null,
  contact_channel: "email",
  evidence: {
    photo_required: "submit a photo of their recalled power bank",
    actions: "written on it in permanent marker",
    marker_text: "the word “recalled”",
    must_show: "photo of their recalled power bank",
    remedy: "full refund",
    refund_amount: "",
    contact_channel: "HAIARArecall@outlook.com",
  },
  ambiguous: [],
  notes: "",
  ...over,
});

describe("label cross-check", () => {
  it("passes a label whose marker text and evidence are in the remedy", () => {
    const l = crossCheck(label(), rec, "photo_refund");
    expect(l.fields.marker_text.check).toBe("pass");
    expect(l.fields.actions.check).toBe("pass");
    expect(l.fields.actions.evidenceFound).toBe(true);
    expect(Object.values(l.fields).every((f) => f.confirmed === false)).toBe(true);
  });
  it("fails marker text that is not literal, and flags a missed marker", () => {
    expect(crossCheck(label({ marker_text: "DESTROYED" }), rec, "photo_refund").fields.marker_text.check).toBe("fail");
    expect(crossCheck(label({ actions: [] }), rec, "photo_refund").fields.actions.check).toBe("fail");
  });
  it("marks evidence that is not in the text", () => {
    const l = crossCheck(label({ evidence: { ...label().evidence, remedy: "a gift card" } }), rec, "photo_refund");
    expect(l.fields.remedy.evidenceFound).toBe(false);
  });
});

describe("scoring", () => {
  it("compares sets, marker text and amounts sensibly", () => {
    expect(fieldCorrect("actions", ["cut_cord", "write_recalled"], ["write_recalled", "cut_cord"])).toBe(true);
    expect(fieldCorrect("marker_text", "Recalled", "RECALLED")).toBe(true);
    expect(fieldCorrect("marker_text", null, "RECALLED")).toBe(false);
    expect(fieldCorrect("refund_amount", 30, 30.001)).toBe(true);
    expect(fieldCorrect("refund_amount", null, null)).toBe(true);
  });
  it("scores a variant field by field and counts a missing rule as wrong", () => {
    const labels: LabelRecord[] = [crossCheck(label(), rec, "photo_refund"), { ...crossCheck(label(), rec, "photo_refund"), number: "missing" }];
    const s = scoreVariant(labels, { "27056": extractBaseline(rec) });
    expect(s.n).toBe(2);
    expect(s.missing).toBe(1);
    expect(s.fields.marker_text.correct).toBe(1);
    expect(s.allFieldsCorrect.count).toBeLessThanOrEqual(1);
    expect(s.actions.f1).toBeGreaterThan(0);
  });
  it("results.json is labeled draft while labels are unconfirmed", () => {
    const res = JSON.parse(readFileSync(path.join(process.cwd(), "content", "recalls", "benchmark", "results.json"), "utf8")) as { status: string; summary: Record<string, { allFields: number }> };
    expect(res.status).toBe("draft");
    expect(Object.keys(res.summary)).toEqual(["baseline", "claude", "claude_selfcheck"]);
  });
});
