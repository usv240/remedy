import { fail, ok } from "@/lib/api/envelope";
import { guard } from "@/lib/api/keys";
import { VERIFY_LIMITS, VerifyFields } from "@/lib/api/v1-schemas";
import { VerifyInputError, keyIdFor, sha256, verifyBody, verifyForApi, verifyMode } from "@/lib/api/verify-service";

/**
 * POST /api/v1/verify (multipart): photo, recall_number, and optionally amount.
 * Runs the six checks against the recall's proof rule and returns the decision. No claim is stored and nothing is paid.
 * Without a key, only the free checks run (no AI call); with a key, the full checks run.
 */
export async function POST(req: Request) {
  return guard(req, "v1.verify", async () => {
    const started = Date.now();
    const form = await req.formData().catch(() => null);
    if (!form) return fail("invalid_request", "Send multipart/form-data with a photo file and a recall_number field.", 400);
    const file = form.get("photo") ?? form.get("file");
    if (!(file instanceof Blob)) return fail("invalid_request", "The photo field is missing. Attach the photo as a file named photo.", 400);
    if (file.size > VERIFY_LIMITS.maxBytes) return fail("invalid_request", "The photo is larger than 10 MB. Send a smaller copy.", 413);
    const fields = VerifyFields.safeParse({ recall_number: String(form.get("recall_number") ?? "").trim() });
    if (!fields.success) return fail("invalid_request", 'recall_number is missing. Add the CPSC recall number, for example "27056".', 422);
    const amount = form.get("amount");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const keyId = await keyIdFor(req);
    const { mode, note } = await verifyMode(keyId, "v1.verify");
    try {
      const v = await verifyForApi({ photo: bytes, mime: file.type || undefined, recallNumber: fields.data.recall_number, amount: typeof amount === "string" ? amount.trim() : null, mode });
      return ok(verifyBody(v, mode, note, sha256(bytes)), started);
    } catch (e) {
      if (e instanceof VerifyInputError) return fail(e.code, e.message, e.status);
      console.error("v1.verify failed", e);
      return fail("internal", "The photo check did not finish. Please try again.", 500);
    }
  });
}
