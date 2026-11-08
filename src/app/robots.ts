import type { MetadataRoute } from "next";
import { HOSTED_URL } from "@/lib/origin";

/** robots.txt: every public page is open to crawlers; the API, owners' receipts and the firm console are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/r/", "/firm/"] },
    sitemap: `${HOSTED_URL}/sitemap.xml`,
  };
}
