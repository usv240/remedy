import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hashContact, maskContact, normalizeContact } from "@/lib/secure";

describe("contact details at rest", () => {
  it("encrypts and decrypts, with a fresh nonce each time", () => {
    const a = encrypt("jordan@example.com");
    const b = encrypt("jordan@example.com");
    expect(a).not.toEqual(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("jordan");
    expect(decrypt(a)).toBe("jordan@example.com");
  });

  it("refuses a value that was changed", () => {
    const sealed = encrypt("+1 415 555 0134");
    const raw = Buffer.from(sealed.slice(3), "base64url");
    raw[raw.length - 1] ^= 1;
    expect(() => decrypt(`v1.${raw.toString("base64url")}`)).toThrow();
  });

  it("hashes the same contact the same way however it is typed", () => {
    expect(normalizeContact("  Jordan@Example.COM ")).toBe("jordan@example.com");
    expect(hashContact("Jordan@Example.com")).toBe(hashContact("jordan@example.com "));
    expect(normalizeContact("+1 (415) 555-0134")).toBe("4155550134");
    expect(hashContact("(415) 555-0134")).toBe(hashContact("+1 415 555 0134"));
    expect(hashContact("a@example.com")).not.toBe(hashContact("b@example.com"));
    expect(hashContact("a@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("masks for the claims grid", () => {
    expect(maskContact("jordan@example.com")).toBe("j•••@example.com");
    expect(maskContact("(415) 555-0134")).toBe("•••-•••-0134");
    expect(maskContact("12")).toBe("•••");
  });
});
