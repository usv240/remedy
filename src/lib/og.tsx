/**
 * Shared pieces for the share images (Open Graph): the brand fonts, the palette, and the frame every card uses.
 * The renderer (next/og) reads TrueType, so src/app/fonts/og holds TTF copies of the site's Sentient.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 };

/** The light theme's tokens, from globals.css. */
export const C = { bg: "#f4f5f0", surface: "#ffffff", surface2: "#e8eae2", ink: "#030407", muted: "#5b606b", accent: "#d4ff24", accentEdge: "#5c7300" };

export async function ogFonts() {
  const dir = join(process.cwd(), "src/app/fonts/og");
  const [light, regular] = await Promise.all([readFile(join(dir, "Sentient-300.ttf")), readFile(join(dir, "Sentient-400.ttf"))]);
  return [
    { name: "Sentient", data: light, weight: 300 as const, style: "normal" as const },
    { name: "Sentient", data: regular, weight: 400 as const, style: "normal" as const },
  ];
}

/** The card: the Remedy wordmark at the top, the content, and one plain line at the foot. */
export function OgFrame({ children, foot }: { children: ReactNode; foot: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, padding: "56px 64px", fontFamily: "Sentient", color: C.ink }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 34, fontWeight: 400, letterSpacing: -0.5 }}>Remedy</div>
      <div style={{ display: "flex", flex: 1, marginTop: 28 }}>{children}</div>
      <div style={{ display: "flex", fontSize: 24, color: C.muted }}>{foot}</div>
    </div>
  );
}
