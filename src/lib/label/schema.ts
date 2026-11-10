import { z } from "zod";

/**
 * What Claude reports when it reads a product label: each field with the exact text read and a confidence, null when
 * the label does not show it. Claude reads; plain code (src/lib/label/reading.ts, src/lib/label/check.ts) decides what
 * the reading is used for and which recall, if any, it names. Scores are not range-limited here (structured outputs drop
 * numeric bounds); code clamps them.
 */
const Field = z.object({
  value: z.string().nullable().describe("Only the item itself, exactly as printed (for example KC101B). Null when the label does not show it or it cannot be read."),
  text_read: z.string().nullable().describe('The whole line it was read from, letter for letter as printed (for example "MODEL: KC101B"). Null when value is null.'),
  confidence: z.number().describe("0 to 1: how sure you are that every character of value is right."),
});

export const LOT_KINDS = ["lot", "batch", "serial", "date_code", "manufacture_date"] as const;

export const LabelReadingSchema = z.object({
  readable: z.boolean().describe("True when the photo shows a product label and at least one field below can be read from it."),
  brand: Field.describe("The brand or maker as printed, a logo included when its letters can be read."),
  product_name: Field.describe("What the product is, as the label names it (for example Coffee Maker)."),
  model_numbers: z
    .array(Field)
    .describe("Every model number, model name, item number or part number printed (Model, Model No., M/N, Type, Item, P/N, Part No., FRU, HVIN). The one labelled Model first. Not FCC IDs, certification numbers, serial numbers or ratings."),
  upc: Field.describe("The digits of a UPC or EAN barcode, digits only in value. Null when no such barcode number is printed."),
  lot_or_date: z
    .array(Field.extend({ kind: z.enum(LOT_KINDS) }))
    .describe("Every lot, batch or serial number, date code or manufacture date printed, each with its kind."),
  person: z
    .object({
      visible: z.boolean().describe("True when a face, a body or a child can be seen. Hands or fingers holding the product, on their own, do not count."),
      where: z.string().describe("Where in the photo, or empty."),
    })
    .describe("Whether a person can be seen in the photo. Code then asks for a photo of the label alone."),
  retake_tip: z.string().describe("When the label is unreadable or its model number is unclear: one short plain sentence on how to take a better photo of it. Otherwise empty."),
});

export type LabelReading = z.infer<typeof LabelReadingSchema>;
export type LabelField = z.infer<typeof Field>;
