import { z } from "zod";

/**
 * Request bodies for Remedy's public product endpoints (/api/v1), written once in Zod: the routes validate with them,
 * and /openapi.json and /developers/docs are generated from them.
 */

export const ProofRuleRequest = z
  .object({
    recall_number: z.string().min(4).max(40).optional().describe('A CPSC recall number, for example "27056". Returns the stored rule for that recall.'),
    remedy_text: z.string().min(20).max(8000).optional().describe("Any recall's remedy text, as the CPSC published it. Returns a rule read from it."),
    consumer_contact: z.string().max(2000).optional().describe("The recall's consumer contact text, which helps find how the photo is sent. Optional."),
    mode: z
      .enum(["quick", "claude"])
      .default("quick")
      .describe('For remedy_text: "quick" is the deterministic reader (no AI, instant). "claude" uses Claude Opus 5.5 with a self-check, needs an API key and counts toward a daily limit.'),
  })
  .refine((b) => Boolean(b.recall_number) !== Boolean(b.remedy_text), { message: "Send either recall_number or remedy_text, not both." });

/** The multipart fields of POST /api/v1/verify, besides the photo file. */
export const VerifyFields = z.object({
  recall_number: z.string().min(4).max(40).describe('The CPSC recall number the photo is for, for example "27056".'),
});

export const VERIFY_LIMITS = {
  /** Bytes. Phone photos are 2 to 6 MB. */
  maxBytes: 10 * 1024 * 1024,
  /** Full vision checks a key may run each day. */
  visionPerKeyPerDay: 25,
  /** Claude proof rules a key may run each day. */
  claudeRulesPerKeyPerDay: 20,
  types: ["image/jpeg", "image/png", "image/webp"],
} as const;
