import { AiRefusedError, AiUnavailableError, publicAiError } from "@/lib/ai/claude";
import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { VERIFY_LIMITS } from "@/lib/api/v1-schemas";
import { keyIdFor } from "@/lib/api/verify-service";
import { allowLabelRead } from "@/lib/label/limits";
import { checkLabel, LabelInputError, sampleByBytes, withOrigin } from "@/lib/label/read";
import { log } from "@/lib/log";
import { publicOrigin } from "@/lib/origin";
import { clientIp } from "@/lib/ratelimit";
import { PhotoUnreadableError, sniffMime } from "@/lib/verify/image";

/**
 * POST /api/v1/label: is this product recalled? Send a photo of its label (multipart, field photo) or a sample label's
 * id (multipart or JSON, field sample). Claude reads the label once; code finds the recall with the catalog scan's
 * matcher, and a model number or UPC in a recall's own list settles it. The photo is never stored. Sample labels, and
 * a sample's own file, replay their recorded reading with no model call. Live readings: 6 in 10 minutes and 20 a day
 * per visitor, 25 a day per key, within the site's daily AI budget.
 */
export async function POST(req: Request) {
  return guard(req, "v1.label", async () => {
    const started = Date.now();
    const type = req.headers.get("content-type") ?? "";
    let sample: string | null = null;
    let photo: Uint8Array | null = null;
    if (type.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) return fail("invalid_request", "Send multipart/form-data with a photo file, or a sample field.", 400);
      const file = form.get("photo") ?? form.get("file");
      sample = String(form.get("sample") ?? "").trim() || null;
      if (file instanceof Blob && file.size > 0) {
        if (file.size > VERIFY_LIMITS.maxBytes) return fail("invalid_request", "The photo is larger than 10 MB. Send a smaller copy.", 413);
        photo = new Uint8Array(await file.arrayBuffer());
      }
    } else {
      const body = (await req.json().catch(() => null)) as { sample?: unknown } | null;
      sample = typeof body?.sample === "string" ? body.sample.trim() || null : null;
    }
    if (!sample && !photo) return fail("invalid_request", 'Send a photo of the label as a file named photo, or { "sample": "kidisle" } for a sample label.', 400);
    if (photo && !sample) {
      const mime = sniffMime(photo);
      if (mime === "image/heic") return fail("invalid_request", "That photo is in HEIC format. Set the camera to Most Compatible, or send a JPEG or PNG.", 415);
      if (!mime) return fail("invalid_request", "That file is not a photo. Send a JPEG, PNG or WebP of the label.", 415);
      // A live reading is one model call: count it, unless the photo is a sample's own file and replays.
      if (!sampleByBytes(photo)) {
        const allowed = await allowLabelRead({ ip: clientIp(req), keyId: await keyIdFor(req) });
        if (!allowed.ok) {
          const res = fail("rate_limited", allowed.plain, 429);
          return new Response(res.body, { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(allowed.retryAfterSec) } });
        }
      }
    }
    try {
      const check = await checkLabel({ sample, photo });
      return ok(withOrigin(check, publicOrigin(req)), started);
    } catch (e) {
      if (e instanceof LabelInputError) return fail(e.status === 404 ? "not_found" : "invalid_request", e.message, e.status);
      if (e instanceof PhotoUnreadableError) return fail("invalid_request", "That photo could not be read. Send a JPEG or PNG of the label.", 422);
      if (e instanceof AiUnavailableError) return fail("upstream_unavailable", `${publicAiError(e, "label reading")} You can search by name, or try a sample label.`, 503);
      if (e instanceof AiRefusedError) return fail("invalid_request", "The label could not be read from this photo. Try a closer photo of the label alone, or search by name.", 422);
      log.error("v1.label failed", { error: e });
      return fail("internal", "The label check did not finish. Please try again, or search by name.", 500);
    }
  });
}
