import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for the one piece of personal data a payment plan must keep: where the payout goes. The key comes from
 * REMEDY_SECRET_KEY (or CHECKS_SECRET until that is set), stretched with SHA-256. Values look like
 * `v1.<iv>.<tag>.<ciphertext>` in base64url. If the shell's src/lib/secure.ts lands, this can delegate to it.
 */
function key() {
  const secret = process.env.REMEDY_SECRET_KEY?.trim() || process.env.CHECKS_SECRET?.trim();
  if (!secret) throw new Error("REMEDY_SECRET_KEY is not set, so payee details cannot be stored.");
  return createHash("sha256").update(`remedy-payments-v1:${secret}`).digest();
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function unseal(sealed: string) {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Not a sealed value.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
