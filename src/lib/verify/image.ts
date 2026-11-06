import sharp, { type Metadata, type Sharp } from "sharp";

/** A greyscale raster, one byte per pixel, row by row. */
export type Grey = { data: Uint8Array; width: number; height: number };

/** One decode of a photo, shared by the quality precheck, the perceptual hash and the vision call. */
export type DecodedImage = {
  width: number;
  height: number;
  /** The file carried camera (EXIF) details. Evidence only: many upload paths strip them. */
  exif: boolean;
  /** Longest side at most 256 px: the source for dHash. */
  hashGrey: Grey;
  /** Longest side at most 512 px, never enlarged: the source for the quality precheck. */
  qualityGrey: Grey;
  /** A JPEG for Claude, longest side at most `visionMaxSide`. */
  jpeg: Buffer;
};

export class PhotoUnreadableError extends Error {}

/**
 * Image sizes sent to Claude. An image costs ceil(width / 28) x ceil(height / 28) visual tokens, and Opus 5.5 reads up
 * to a 2,576 px long edge (4,784 tokens) before downsizing (platform.claude.com/docs/en/build-with-claude/vision.md,
 * fetched 2026-11-05). A 4:3 phone photo at 1,280 px is 46 x 35 = 1,610 tokens, against 2,352 at 1,568 px and 4,784
 * at full size, and still shows a cut cord or marker writing plainly.
 */
export const VISION_MAX_SIDE = 1280;
/** When the proof rule asks for a model, lot or date code, small label print gets more pixels. */
export const LABEL_MAX_SIDE = 1568;
/** Official images only need to show the product, so they go in smaller and cost fewer tokens. */
export const OFFICIAL_MAX_SIDE = 768;

/** Visual tokens for an image of this size, as the API counts them (before any downsizing it applies). */
export const visualTokens = (width: number, height: number) => Math.ceil(width / 28) * Math.ceil(height / 28);

/** The long edge for the claim photo under this proof rule. */
export function claimMaxSide(mustShow: readonly string[]): number {
  return mustShow.some((m) => m === "model_number" || m === "serial_or_lot" || m === "date_code") ? LABEL_MAX_SIDE : VISION_MAX_SIDE;
}

const LIMIT_INPUT_PIXELS = 60_000_000;

async function grey(input: Sharp, max: number, enlarge: boolean): Promise<Grey> {
  // Transparent areas become white, as they look on a page, so a PNG and its JPEG copy hash alike.
  const { data, info } = await input
    .clone()
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(max, max, { fit: "inside", withoutEnlargement: !enlarge })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  if (info.channels === 1) return { data: new Uint8Array(data.buffer, data.byteOffset, px), width: info.width, height: info.height };
  const out = new Uint8Array(px);
  for (let i = 0; i < px; i++) out[i] = data[i * info.channels];
  return { data: out, width: info.width, height: info.height };
}

/**
 * Decode once, honouring the camera's orientation, and produce every view the checks need.
 * Throws PhotoUnreadableError for files sharp cannot read (for example HEIC, which the prebuilt sharp does not decode).
 */
export async function decodeImage(bytes: Buffer | Uint8Array, maxSide = VISION_MAX_SIDE): Promise<DecodedImage> {
  let base: Sharp;
  let meta: Metadata;
  try {
    base = sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: "error" }).rotate();
    meta = await base.metadata();
  } catch (e) {
    throw new PhotoUnreadableError(`The image could not be read: ${(e as Error).message}`);
  }
  // Orientations 5 to 8 swap width and height once applied.
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new PhotoUnreadableError("The image has no size.");
  try {
    const [hashGrey, qualityGrey, jpeg] = await Promise.all([
      grey(base, 256, true),
      grey(base, 512, false),
      base
        .clone()
        .flatten({ background: "#ffffff" })
        .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer(),
    ]);
    return { width, height, exif: Boolean(meta.exif), hashGrey, qualityGrey, jpeg };
  } catch (e) {
    throw new PhotoUnreadableError(`The image could not be processed: ${(e as Error).message}`);
  }
}

/**
 * Only the hash view (oriented, at most 256 px), for hashing a stored image without the other views. Lenient about
 * slightly damaged files, as official images sometimes are; the pixels it yields match `decodeImage`'s hash view.
 */
export async function decodeHashGrey(bytes: Buffer | Uint8Array): Promise<Grey> {
  try {
    return await grey(sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: "none" }).rotate(), 256, true);
  } catch (e) {
    throw new PhotoUnreadableError(`The image could not be read: ${(e as Error).message}`);
  }
}

/** Sniff the real type from the bytes; the declared mime can be wrong. */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return "image/heic";
  }
  return null;
}
