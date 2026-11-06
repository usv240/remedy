import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { VerifyProofRule, VerifyRecall } from "./types";

/**
 * The verifier's fixture set in content/verify/fixtures: three real CPSC recalls with their official images on disk,
 * derived copies for the own-photo and quality checks, and the user's photos once they are added.
 * Used by the tests, and available to the benchmark and presets. Server only.
 */

export const FIXTURES_DIR = path.join(process.cwd(), "content", "verify", "fixtures");

export const fixtureFile = (rel: string) => readFileSync(path.join(FIXTURES_DIR, rel));

type RawRecall = Omit<VerifyRecall, "images"> & { images: { url: string; caption: string; file?: string }[]; proofRule: VerifyProofRule };

/** Recalls by number, with official image bytes attached so no download is needed. */
export function loadFixtureRecalls(): Record<string, { recall: VerifyRecall; rule: VerifyProofRule }> {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "recalls.json"), "utf8")) as { recalls: RawRecall[] };
  return Object.fromEntries(
    raw.recalls.map((r) => {
      const { proofRule, images, ...rest } = r;
      const recall: VerifyRecall = { ...rest, images: images.map((i) => ({ url: i.url, caption: i.caption, data: i.file ? fixtureFile(i.file) : undefined })) };
      return [r.number, { recall, rule: proofRule }];
    }),
  );
}

export type FixtureExpect = { decision?: string; not_decision?: string; decided_by?: string; checks?: Record<string, string>; c3_plain?: string };
export type FixtureCase = { id: string; photo: string; recall: string; prior_from?: string[]; needs_vision?: boolean; official_hash_check?: boolean; expect: FixtureExpect };

/** Whether a finished verification meets a case's expectation, with the reasons when it does not. */
export function meetsExpectation(
  e: FixtureExpect,
  r: { decision: string; decided_by: string; checks: Record<string, { status: string; reason_plain: string }> },
): { ok: boolean; misses: string[] } {
  const misses: string[] = [];
  if (e.decision && r.decision !== e.decision) misses.push(`decision ${r.decision}, expected ${e.decision}`);
  if (e.not_decision && r.decision === e.not_decision) misses.push(`decision ${r.decision}, expected anything else`);
  if (e.decided_by && r.decided_by !== e.decided_by) misses.push(`decided by ${r.decided_by}, expected ${e.decided_by}`);
  for (const [id, status] of Object.entries(e.checks ?? {})) if (r.checks[id]?.status !== status) misses.push(`${id} ${r.checks[id]?.status}, expected ${status}`);
  if (e.c3_plain && r.checks.C3?.reason_plain !== e.c3_plain) misses.push(`C3 said "${r.checks.C3?.reason_plain}"`);
  return { ok: misses.length === 0, misses };
}

export function loadFixtureCases(): FixtureCase[] {
  return (JSON.parse(readFileSync(path.join(FIXTURES_DIR, "cases.json"), "utf8")) as { cases: FixtureCase[] }).cases;
}

/** The user's photos listed in user/expected.json, as cases. Files that are listed but missing are skipped. */
export function loadUserCases(): FixtureCase[] {
  const file = path.join(FIXTURES_DIR, "user", "expected.json");
  if (!existsSync(file)) return [];
  const map = JSON.parse(readFileSync(file, "utf8")) as Record<string, { recall: string; decision?: string; checks?: Record<string, string> }>;
  return Object.entries(map)
    .filter(([name]) => existsSync(path.join(FIXTURES_DIR, "user", name)))
    .map(([name, e]) => ({ id: `user/${name}`, photo: `user/${name}`, recall: e.recall, needs_vision: true, expect: { decision: e.decision, checks: e.checks } }));
}
