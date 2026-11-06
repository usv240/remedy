/**
 * Channel3 product search (https://api.trychannel3.com): real products across retailers, used to offer an owner a safe
 * replacement for a recalled product. The caller checks each result against active recalls before showing it.
 * Without CHANNEL3_API_KEY every call answers "not connected" with no products, so the flow can offer a refund instead.
 */
import { createHash } from "node:crypto";

const BASE = "https://api.trychannel3.com/v1";

export type FoundProduct = {
  id: string;
  title: string;
  brand: string | null;
  image: string | null;
  imageAlt: string | null;
  url: string | null;
  domain: string | null;
  price: number;
  currency: string;
  inStock: boolean;
  categoryPath: string | null;
};

export type ProductSearch = { mode: "live" | "not_connected"; products: FoundProduct[]; note?: string };

export const channel3Configured = () => Boolean(process.env.CHANNEL3_API_KEY?.trim());

export type C3Product = {
  id: string;
  title: string;
  brands?: { id?: string; name?: string }[];
  images?: { url: string; cleaned_url?: string | null; is_main_image?: boolean; alt_text?: string | null }[];
  category?: { slug?: string; title?: string; path?: string | (string | { slug?: string; title?: string })[] } | null;
  offers?: { url: string; domain: string; price: { price: number; currency: string }; availability: string }[];
};

/** Channel3's product record in the shape Remedy shows: its best in-stock offer, main image and category path. */
export function normalize(p: C3Product): FoundProduct | null {
  const offer = (p.offers ?? []).find((o) => o.availability === "InStock") ?? p.offers?.[0];
  if (!offer) return null;
  const img = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  const raw = p.category?.path;
  const path = Array.isArray(raw) ? raw.map((x) => (typeof x === "string" ? x : (x.title ?? x.slug ?? ""))).filter(Boolean).join(" > ") : (raw ?? p.category?.title ?? null);
  return {
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name ?? null,
    image: img ? (img.cleaned_url ?? img.url) : null,
    imageAlt: img?.alt_text ?? null,
    url: offer.url,
    domain: offer.domain,
    price: Math.round(offer.price.price * 100) / 100,
    currency: offer.price.currency,
    inStock: offer.availability === "InStock",
    categoryPath: path || null,
  };
}

function headers(user?: string) {
  return {
    "x-api-key": process.env.CHANNEL3_API_KEY!.trim(),
    // Channel3 asks for a stable end-user id; a hash, never the person's details.
    "x-user-id": createHash("sha256").update(user ?? "remedy").digest("hex").slice(0, 24),
    "Content-Type": "application/json",
  };
}

const NOT_CONNECTED: ProductSearch = { mode: "not_connected", products: [], note: "Replacement search is not connected on this server, so a refund is offered instead." };
const cache = new Map<string, { at: number; value: FoundProduct[] }>();

/** Search Channel3 for in-stock products. Results are cached for ten minutes to save credits. */
export async function findProducts(query: string, o: { maxPrice?: number; user?: string; limit?: number } = {}): Promise<ProductSearch> {
  if (!channel3Configured()) return NOT_CONNECTED;
  const q = query.trim().slice(0, 120);
  const limit = Math.min(12, o.limit ?? 8);
  const key = JSON.stringify([q, o.maxPrice ?? null, limit]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return { mode: "live", products: hit.value };
  const body = { query: q, limit, filters: { availability: ["InStock"], ...(o.maxPrice ? { price: { max_price: o.maxPrice } } : {}) } };
  const r = await fetch(`${BASE}/search`, { method: "POST", headers: headers(o.user), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Channel3 answered ${r.status}`);
  const j = (await r.json()) as { products?: C3Product[] };
  const products = (j.products ?? []).map(normalize).filter((p): p is FoundProduct => p !== null);
  cache.set(key, { at: Date.now(), value: products });
  return { mode: "live", products };
}

/** One product's current record (price and stock change), or null when Channel3 does not know it. */
export async function getProduct(id: string, user?: string): Promise<FoundProduct | null> {
  if (!channel3Configured()) return null;
  const r = await fetch(`${BASE}/products/${encodeURIComponent(id)}`, { headers: headers(user), signal: AbortSignal.timeout(15_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Channel3 answered ${r.status}`);
  return normalize((await r.json()) as C3Product);
}
