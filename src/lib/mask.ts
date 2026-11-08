/**
 * Masking for anything that leaves the process: log lines (src/lib/log.ts) and error reports (src/lib/sentry.ts).
 * No imports, so it runs on the server, the edge runtime and in the browser alike. Emails, phone numbers, photo
 * bytes, keys and secret-looking values never get through.
 */

const SECRET_KEY = /(secret|token|password|passwd|authorization|api[_-]?key|cookie|private|signature|credential)/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** A run of 10 or more digits, with the usual separators: a phone number, a card or an account number. */
const LONG_DIGITS = /(?:\(?\+?\d[\d\s().-]{8,}\d)/g;
const DATA_URI = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{16,}/g;
/** A long run of base64 or hex: photo bytes, a key, a hash chain. Keep hashes (64 hex) readable, mask longer runs. */
const LONG_BLOB = /[A-Za-z0-9+/=_-]{120,}/g;
/**
 * Credentials that must never reach a page, an API response, a log line or a stored row, whatever carries them: an
 * Anthropic key, a bearer or basic credential, a PayPal access token, and NAME=value lines from a pasted .env block.
 */
const SECRETS: [RegExp, (m: string) => string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, () => "[redacted key]"],
  [/\b(?:Bearer|Basic|ApiKey)\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{16,}/g, (m) => `${m.split(/\s+/)[0]} [redacted]`],
  [/\bA21AA[A-Za-z0-9_-]{16,}/g, () => "[redacted token]"],
  [/\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)=[^\s"'\,;]{8,}/g, (m) => `${m.slice(0, m.indexOf("="))}=[redacted]`],
];

/** The same text with every credential-looking run replaced. Plain words, numbers and ids pass through unchanged. */
export function redactSecrets(s: string): string {
  let out = s;
  for (const [re, to] of SECRETS) out = out.replace(re, to);
  return out;
}

/** A copy of any JSON-like value with redactSecrets applied to every string in it. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (value === null || typeof value !== "object" || depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as T;
  if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, depth + 1);
  return out as T;
}

/** A Remedy API key (rm_test_...): only its display prefix is kept, as the Developers page shows it. */
const REMEDY_KEY = /\brm_[A-Za-z0-9_]{8,}/g;

/** "jordan@example.com" reads "j•••@example.com"; "(415) 555-0134" reads "•••-•••-0134" (the same as src/lib/secure.ts). */
export function maskContact(value: string): string {
  const v = value.trim();
  const at = v.indexOf("@");
  if (at > 0) return `${v[0]}•••${v.slice(at)}`;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : "•••";
}

export function maskString(s: string): string {
  if (s.length > 4000) return `[${s.length} chars]`;
  return redactSecrets(s)
    .replace(DATA_URI, "[image data]")
    .replace(EMAIL, (m) => maskContact(m))
    .replace(REMEDY_KEY, (m) => `${m.slice(0, 12)}…`)
    .replace(LONG_DIGITS, (m) => (m.replace(/\D/g, "").length >= 10 ? maskContact(m) : m))
    .replace(LONG_BLOB, (m) => `[${m.length} chars]`);
}

const isBytes = (v: unknown): v is { byteLength: number } => typeof v === "object" && v !== null && "byteLength" in v && (v instanceof Uint8Array || v instanceof ArrayBuffer);

/**
 * A copy of `value` safe to print: contact details masked, byte buffers reduced to their size, secret-looking keys
 * redacted, errors reduced to name, message and the top of the stack, and anything deeper than six levels cut.
 */
export function mask(value: unknown, depth = 0, key = ""): unknown {
  if (value === null || value === undefined) return value;
  if (SECRET_KEY.test(key) && typeof value !== "object") return "[redacted]";
  if (typeof value === "string") return maskString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: maskString(value.message), stack: value.stack?.split("\n").slice(0, 6).map(maskString).join("\n") };
  }
  if (isBytes(value)) return `[${value.byteLength} bytes]`;
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (depth >= 6) return "[deep]";
  if (Array.isArray(value)) return value.length > 50 ? [...value.slice(0, 50).map((v) => mask(v, depth + 1)), `[${value.length - 50} more]`] : value.map((v) => mask(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "bytes" || k === "photo" || k === "image" || k === "pdf") {
        out[k] = typeof v === "string" ? `[${v.length} chars]` : mask(v, depth + 1, k);
        continue;
      }
      out[k] = mask(v, depth + 1, k);
    }
    return out;
  }
  return String(value);
}
