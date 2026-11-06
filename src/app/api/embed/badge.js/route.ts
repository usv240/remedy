import { connection } from "next/server";
import { badgeScript } from "@/lib/embed/badge";
import { publicOrigin } from "@/lib/origin";

/** GET /api/embed/badge.js: one script tag with data-recall="27056" (or data-q="power bank") inserts the badge iframe. */
export async function GET(req: Request) {
  await connection();
  return new Response(badgeScript(publicOrigin(req)), {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}
