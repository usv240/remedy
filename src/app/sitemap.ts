import type { MetadataRoute } from "next";
import picks from "../../content/recalls/demo-picks.json";
import { HOSTED_URL } from "@/lib/origin";
import samples from "../../content/recalls/samples.json";

/** sitemap.xml: the public pages, the sample recall and the real CPSC recalls the demo features. No database read. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/try", "/recalls", "/evidence", "/evidence/photo-checks", "/evidence/operations", "/evidence/market", "/learn", "/developers", "/about", "/stack", "/status"];
  const sample = (samples as { recalls: { number: string }[] }).recalls.map((r) => r.number);
  const recalls = [...new Set([...sample, ...(picks.picks as { recall?: string; number?: string }[]).map((p) => p.recall ?? p.number).filter(Boolean) as string[]])];
  return [
    ...pages.map((p) => ({ url: `${HOSTED_URL}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : p === "/evidence" || p === "/try" ? 0.9 : 0.6 })),
    ...recalls.flatMap((n) => [
      { url: `${HOSTED_URL}/recalls/${n}`, changeFrequency: "monthly" as const, priority: 0.5 },
      { url: `${HOSTED_URL}/claim/${n}`, changeFrequency: "monthly" as const, priority: 0.5 },
    ]),
  ];
}
