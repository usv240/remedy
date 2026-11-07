import { z } from "zod";
import { PROOF_ACTIONS } from "./types";

/**
 * What the one vision call reports for C1 to C4 and the screen part of C3. The model describes; code decides.
 * Scores are not range-limited in the schema (structured outputs drop numeric bounds); code clamps them.
 */
export const VisionReportSchema = z.object({
  scene: z.string().describe("One plain sentence: what the owner's photo shows."),
  product: z.object({
    match_score: z.number().describe("0 to 1: how sure you are that the owner's photo shows the same product as the recall."),
    matching_details: z.array(z.string()).describe("Visible details that match the official images or product data, each naming where it is in the photo."),
    differing_details: z.array(z.string()).describe("Visible details that differ from the official images or product data."),
    reason_plain: z.string().describe("Under 25 words, plain language, starting with the answer."),
    reason_technical: z.string().describe("Which details decided the score."),
  }),
  actions: z
    .array(
      z.object({
        action: z.enum(PROOF_ACTIONS),
        done: z.boolean().describe("True only when the photo itself shows this action complete."),
        confidence: z.number().describe("0 to 1."),
        evidence: z.string().describe("What you see and where in the photo."),
      }),
    )
    .describe("One entry for each required action, in the order given."),
  handwritten_text: z
    .array(
      z.object({
        text: z.string().describe("Exactly as written, letter for letter, keeping misspellings."),
        on_product: z.boolean().describe("True when written on the product itself, not on paper or a note beside it."),
        where: z.string(),
      }),
    )
    .describe("Every piece of handwritten or marker writing. Not printed text."),
  identifiers: z.object({
    model_text: z.string().nullable().describe("Model number exactly as printed, or null if not clearly readable."),
    lot_text: z.string().nullable().describe("Lot, batch or serial number exactly as printed, or null."),
    date_code_text: z.string().nullable().describe("Date code exactly as printed, or null."),
    label_visible: z.boolean(),
    where: z.string().nullable(),
  }),
  photo_source: z.object({
    kind: z.enum(["camera_photo", "photo_of_screen", "photo_of_printout", "digital_image", "unsure"]),
    signs: z.array(z.enum(["moire", "screen_bezel", "screen_glare", "pixel_grid", "app_or_web_ui", "paper_texture", "halftone_dots", "paper_edge", "watermark", "studio_background", "no_camera_noise", "none"])),
    confidence: z.number().describe("0 to 1: how sure you are of `kind`."),
    reason: z.string(),
  }),
  retake_tip: z.string().describe("One short plain sentence on what to change in the next photo, or empty."),
  person: z
    .object({
      visible: z.boolean().describe("True when a face, a body or a child can be seen in the owner's photo. Hands or fingers holding the product, on their own, do not count."),
      kinds: z.array(z.enum(["face", "body", "child"])).describe("What of a person can be seen. Empty when visible is false."),
      where: z.string().describe("Where in the photo, or empty."),
    })
    .describe("Whether a person can be seen in the owner's photo. Code asks for a photo of the product alone and deletes this one."),
});

export type VisionReport = z.infer<typeof VisionReportSchema>;

/** People seen in the photo. Reports recorded before this field existed carry none, which reads as no person. */
export function personInPhoto(r: Pick<VisionReport, "person"> | { person?: VisionReport["person"] } | null | undefined): VisionReport["person"] | null {
  const p = r?.person;
  return p?.visible ? { visible: true, kinds: [...(p.kinds ?? [])], where: p.where ?? "" } : null;
}

/** Two reviewers, two evidence bases (plan 7.2). */
export const REVIEW_CHECKS = ["right_product", "made_safe", "own_photo", "within_recall"] as const;

export const ReviewSchema = z.object({
  answer: z
    .enum(["meets", "does_not_meet", "unclear"])
    .describe("meets: the photo shows what your evidence requires. does_not_meet: it clearly does not. unclear: your evidence does not settle it."),
  evidence: z
    .array(
      z.object({
        check: z.enum(REVIEW_CHECKS),
        seen: z.string().describe("The specific visible detail in the owner's photo, described so another person could find it."),
        where: z.string().describe("Where in the photo: for example top left, on the cord near the plug, on the front panel."),
      }),
    )
    .describe("Every visible detail you relied on. A program checks these; an answer without visible evidence is set aside."),
  model_read: z.string().nullable().describe("A model number you can read in the owner's photo, exactly as printed, or null."),
  marker_text_read: z.string().nullable().describe("Handwritten text on the product exactly as written, or null."),
  reason_plain: z.string().describe("Under 30 words, everyday language, calm and direct. Start with the answer."),
  reason_technical: z.string(),
  confidence: z.number().describe("0 to 1."),
});

export type ReviewReport = z.infer<typeof ReviewSchema>;
