/**
 * Personal data at rest. Contact details (a payee's email or phone, a buyer's contact, a firm's PayPal app secret) are
 * stored encrypted (AES-256-GCM, `*_enc` columns) and, where Remedy must match them without decrypting (claims per
 * payee, buyers in a sales file), as a keyed hash (`*_hash` columns). The claims grid shows only a masked form.
 *
 * DATA_KEY: any long random string; the AES key is its SHA-256. Set one in production. Without it a fixed
 * development key is used, so local data is readable on this machine only by design of the demo, never in production.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const DEV_KEY = "remedy-development-only-data-key";

function key() {
  const raw = process.env.DATA_KEY?.trim();
  if (!raw && process.env.NODE_ENV === "production" && process.env.REMEDY_ALLOW_DEV_KEY !== "1") {
    throw new Error("DATA_KEY is not set, so personal data cannot be stored.");
  }
  return createHash("sha256")
    .update(raw || DEV_KEY)
    .digest();
}

/** Encrypt a short string. Output: "v1." then base64url of iv (12 bytes), tag (16 bytes) and ciphertext. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url")}`;
}

/** Decrypt what encrypt() wrote. Throws if the value was changed or the key is different. */
export function decrypt(sealed: string): string {
  if (!sealed.startsWith("v1.")) throw new Error("Unknown encrypted value format.");
  const buf = Buffer.from(sealed.slice(3), "base64url");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

/** Emails compare in lower case without spaces; US phone numbers compare as their last 10 digits. */
export function normalizeContact(value: string): string {
  const v = value.trim();
  if (v.includes("@")) return v.toLowerCase();
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** A keyed hash of a contact, the same for "Jo@Example.com" and "jo@example.com ", useless without the server's salt. */
export function hashContact(value: string): string {
  return createHmac("sha256", process.env.AUDIT_SALT || "remedy")
    .update(normalizeContact(value))
    .digest("hex");
}

/** "jordan@example.com" reads "j•••@example.com"; "(415) 555-0134" reads "•••-•••-0134". */
export function maskContact(value: string): string {
  const v = value.trim();
  const at = v.indexOf("@");
  if (at > 0) return `${v[0]}•••${v.slice(at)}`;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : "•••";
}
