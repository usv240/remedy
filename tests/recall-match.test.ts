import { describe, expect, it } from "vitest";
import { decide, heuristicMatch, type Candidate } from "@/lib/recall/match";
import { fmtFdaDate, parseVehicle } from "@/lib/recall/sources";
import { matchesNursery } from "@/lib/recall/cpsc-client";

describe("decide: confidence thresholds", () => {
  it("maps to MATCH / REVIEW / CLEAR", () => {
    expect(decide(0.92)).toBe("MATCH");
    expect(decide(0.75)).toBe("MATCH");
    expect(decide(0.74)).toBe("REVIEW");
    expect(decide(0.4)).toBe("REVIEW");
    expect(decide(0.39)).toBe("CLEAR");
    expect(decide(0)).toBe("CLEAR");
  });
});

describe("heuristicMatch", () => {
  const cands: Candidate[] = [
    { recall_number: "27056", title: "HAIARA Power Banks Recalled", product: "HAIARA power bank model W5 PRO", hazard: "lithium battery overheating fire burn" },
    { recall_number: "27045", title: "QZH.DUAO Pajama Sets", product: "children pajama sets", hazard: "flammability burn sleepwear" },
  ];
  it("picks the recall with the most overlap", () => {
    const r = heuristicMatch("HAIARA power bank W5 PRO battery overheating", cands);
    expect(r.recallNumber).toBe("27056");
    expect(r.mode).toBe("heuristic");
    expect(r.decision).not.toBe("CLEAR");
  });
  it("is CLEAR when nothing overlaps", () => {
    const r = heuristicMatch("wooden garden bench", cands);
    expect(r.recallNumber).toBeNull();
    expect(r.decision).toBe("CLEAR");
  });
});

describe("other sources", () => {
  it("parses make, model and year for NHTSA", () => {
    expect(parseVehicle("Honda Civic 2018")).toEqual({ make: "Honda", model: "Civic", year: "2018" });
    expect(parseVehicle("power bank")).toBeNull();
  });
  it("formats FDA dates", () => {
    expect(fmtFdaDate("20261029")).toBe("2026-10-29");
    expect(fmtFdaDate("bad")).toBe("");
  });
  it("finds nursery products", () => {
    expect(matchesNursery({ Title: "PILLANI Recalls Nursing Pillows" })).toBe(true);
    expect(matchesNursery({ Title: "DREO Recalls Space Heaters" })).toBe(false);
  });
});
