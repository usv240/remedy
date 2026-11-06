import { assessQuality, qualityGuidance } from "@/lib/verify/quality";
import type { QualityReport } from "@/lib/verify/types";

/**
 * The same quality precheck the server runs (blur, light, size), here in the browser before upload, so a blurry
 * photo is caught in a moment and costs nothing. The server checks again; this only saves a round trip.
 */

export const ACCEPT = "image/jpeg,image/png";
export const MAX_BYTES = 15 * 1024 * 1024;

export type PhotoCheck =
  | { ok: true; report: QualityReport; width: number; height: number }
  | { ok: false; kind: "heic" | "type" | "size" | "unreadable"; message: string }
  | { ok: false; kind: "quality"; message: string; steps: string[]; report: QualityReport; width: number; height: number };

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

export async function checkPhoto(file: File): Promise<PhotoCheck> {
  if (isHeic(file)) {
    return { ok: false, kind: "heic", message: "This photo is in the iPhone HEIC format, which we cannot read yet. Please choose a JPEG, or set Settings, Camera, Formats to Most Compatible and take it again." };
  }
  if (file.type && !/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, kind: "type", message: "Please choose a photo in JPEG or PNG format." };
  if (file.size > MAX_BYTES) return { ok: false, kind: "size", message: "That photo is over 15 MB. Please choose a smaller one." };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, kind: "unreadable", message: "We could not open this photo. Please choose a JPEG or PNG." };
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, 512 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return { ok: true, report: { ok: true, issues: [], metrics: { width, height, sharpness: 0, laplacianVariance: 0, meanLuma: 0, p95Luma: 0, p05Luma: 0 } }, width, height };
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const grey = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) grey[p] = Math.round(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]);
  const report = assessQuality({ data: grey, width: w, height: h }, { width, height });
  if (report.ok) return { ok: true, report, width, height };
  const g = qualityGuidance(report);
  const lead = report.issues[0] === "blurry" ? "A bit blurry. Hold still and try again." : g.plain;
  return { ok: false, kind: "quality", message: lead, steps: g.steps, report, width, height };
}
