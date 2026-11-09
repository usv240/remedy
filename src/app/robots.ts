import type { MetadataRoute } from "next";
import { pageOrigin } from "@/lib/origin";

/** robots.txt: every public page is open to crawlers; the API, owners' receipts and the firm console are not. The sitemap is named on the request's own host, as in sitemap.ts. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const HOSTED_URL = await pageOrigin();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/r/", "/firm/"] },
    sitemap: `${HOSTED_URL}/sitemap.xml`,
  };
}
