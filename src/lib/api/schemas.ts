import { z } from "zod";

/**
 * Request bodies for the public API, written once in Zod: the routes validate with them and /openapi.json and the docs
 * are generated from them. Remedy's product requests are added here as their endpoints ship.
 */
export const KeyRequest = z.object({
  name: z.string().min(1).max(80).describe("Your name or your team's."),
  email: z.email().max(200).describe("Where to reach you about the key."),
  purpose: z.string().max(200).optional().describe("What you are building. Optional."),
  accept: z.literal(true).describe("You accept that sandbox keys are for testing, with no real money and no real personal data."),
});
