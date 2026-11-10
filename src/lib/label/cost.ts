/**
 * What one label reading costs, estimated from the picture's size before any call: Claude Opus 5.5 at effort low, the
 * prompt billed as a cache write ($5 per million tokens), as the recorded sample readings were. Pure: the photo eval's
 * plan (scripts/label/eval-photos.ts) and /evidence read it.
 */
import { LABEL_MAX_SIDE, visualTokens } from "@/lib/verify/image";

/** Tokens a reading costs besides the image (instructions and the output schema), measured on the recorded samples. */
export const OVERHEAD_TOKENS = 2450;
/** Output tokens a reading takes, rounded up from the recorded samples (295 to 420). */
export const OUTPUT_TOKENS = 500;

/** The image as sent: fit inside LABEL_MAX_SIDE, never enlarged. */
export const sentSize = (w: number, h: number) => {
  const k = Math.min(1, LABEL_MAX_SIDE / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)] as const;
};

/** US dollars for one reading of a picture this size, at most. */
export const readingUsd = (c: { width: number; height: number }) => {
  const [w, h] = sentSize(c.width, c.height);
  return ((OVERHEAD_TOKENS + visualTokens(w, h)) * 5 + OUTPUT_TOKENS * 20) / 1e6;
};

/** The estimate for a set of pictures, rounded to the cent. */
export const estimateTotal = (cases: { width: number; height: number }[]) => Math.round(cases.reduce((s, c) => s + readingUsd(c), 0) * 100) / 100;
