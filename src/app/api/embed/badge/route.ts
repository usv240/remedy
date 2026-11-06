import { connection } from "next/server";
import { badgeData, badgeHtml } from "@/lib/embed/badge";
import { publicOrigin } from "@/lib/origin";

/**
 * GET /api/embed/badge?recall=27056 (or ?q=power bank): a chrome-free HTML badge for an iframe on any site. Inputs are
 * escaped; the page may be framed anywhere (next.config.ts leaves /api/embed out of the site's frame-ancestors rule).
 */
export async function GET(req: Request) {
  await connection();
  const p = new URL(req.url).searchParams;
  const data = await badgeData({ recall: p.get("recall"), q: p.get("q") }).catch(() => ({ found: false as const, recall: null, line: "", refund: "", claimPath: null }));
  return new Response(badgeHtml(data, publicOrigin(req)), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *",
    },
  });
}
