import { dhashGrey } from "./dhash";
import { decodeImage, OFFICIAL_MAX_SIDE } from "./image";
import type { RecallImage } from "./types";

/**
 * The claimed recall's official CPSC images: downloaded once, shrunk for the vision call and hashed (the one dHash, the
 * same function that wrote content/recalls/image-hashes.json) for the own-photo check.
 * Cached in memory by URL, so later claims on the same recall skip the download.
 */

export type OfficialImage = { url: string; caption: string | null; jpeg: Buffer; dhash: string };

/** Loaded for hashing when the recall has no stored hashes. */
export const MAX_OFFICIAL_IMAGES = 5;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 12 * 1024 * 1024;
const CACHE_LIMIT = 300;

const cache = new Map<string, Promise<OfficialImage | null>>();

/** cpsc.gov answers image URLs with a redirect to www.cpsc.gov; going there directly saves a round trip. */
export function normalizeImageUrl(url: string): string {
  return url.replace(/^https?:\/\/cpsc\.gov\//i, "https://www.cpsc.gov/");
}

/** Only public http(s) hosts: never localhost or a private address, since URLs can come from scraped pages. */
export function isFetchableUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "[::1]") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}

export type FetchImage = (url: string) => Promise<Uint8Array>;

export const fetchImageBytes: FetchImage = async (url) => {
  const res = await fetch(normalizeImageUrl(url), {
    headers: { "User-Agent": "Remedy/1.0 (recall photo verification)", Accept: "image/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("Image too large");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error("Image too large");
  return buf;
};

async function prepare(img: RecallImage, fetchImage: FetchImage): Promise<OfficialImage | null> {
  try {
    let bytes: Uint8Array;
    if (img.data) bytes = img.data;
    else if (isFetchableUrl(img.url)) bytes = await fetchImage(img.url);
    else return null;
    const d = await decodeImage(bytes, OFFICIAL_MAX_SIDE);
    return { url: img.url, caption: img.caption ?? null, jpeg: d.jpeg, dhash: dhashGrey(d.hashGrey) };
  } catch {
    return null;
  }
}

/** Official images sent to Claude per call: two product views identify a product as well as five, at less cost. */
export const VISION_OFFICIAL_IMAGES = 2;

/** Packaging, labels, receipts and made-safe examples come after product views when choosing what Claude sees. */
const SECONDARY = /packag|label|receipt|example|cut|disposal|trash|destroy|unusable/i;

/**
 * The official images Claude sees: product views first, in CPSC's order, then the rest, at most two. Hashing still
 * covers every official image of the recall (stored hashes, or all loaded ones).
 */
export function pickForVision<T extends { caption?: string | null }>(images: readonly T[], n = VISION_OFFICIAL_IMAGES): T[] {
  const primary = images.filter((i) => !SECONDARY.test(i.caption ?? ""));
  const rest = images.filter((i) => SECONDARY.test(i.caption ?? ""));
  return [...primary, ...rest].slice(0, n);
}

/**
 * Up to `max` official images (default three), prepared in parallel. Images that cannot be fetched are left out
 * (the vision check then leans on the product text), and the failure is reported.
 */
export async function loadOfficialImages(images: readonly RecallImage[], fetchImage: FetchImage = fetchImageBytes, max = MAX_OFFICIAL_IMAGES): Promise<{ images: OfficialImage[]; failed: string[] }> {
  const wanted = images.slice(0, max);
  const results = await Promise.all(
    wanted.map((img) => {
      if (img.data) return prepare(img, fetchImage);
      const key = img.url;
      let p = cache.get(key);
      if (!p) {
        p = prepare(img, fetchImage).then((r) => {
          if (!r) cache.delete(key);
          return r;
        });
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
        cache.set(key, p);
      }
      return p;
    }),
  );
  return { images: results.filter((r): r is OfficialImage => r !== null), failed: wanted.filter((_, i) => !results[i]).map((w) => w.url) };
}
