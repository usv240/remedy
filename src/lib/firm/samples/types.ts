import type { CheckId, CheckResult } from "@/lib/verify/types";

/** The photos of the sample charger a sample claim can carry, each with recorded runs. */
export type SamplePhoto = "made_safe" | "opened" | "opened_case";
export type StoredCheck = Pick<CheckResult, "id" | "name" | "pass" | "status" | "reason_plain" | "reason_technical"> & { score?: number };

/** One recorded run of a sample photo (src/lib/firm/samples/claim-runs.json, written by scripts/verify/sample-claim-runs.ts). */
export type SampleRun = {
  id: string;
  photo: SamplePhoto;
  /** The recording this run is read from, and where in it. */
  from: { file: string; at: string; trial: number | null; recordedAt: string };
  model: string;
  decision: "verified" | "retake" | "firm_review";
  decidedBy: string;
  checks: Record<CheckId, StoredCheck>;
  summary: { plain: string; technical: string };
  /** The two reviewers' recorded votes and the referee's answer, when the recording kept them. */
  review: unknown | null;
};
export type SampleRunsFile = { note: string; runs: SampleRun[] };
