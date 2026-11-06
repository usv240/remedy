import { ImageResponse } from "next/og";
import { C, OG_SIZE, OgFrame, ogFonts } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Remedy: recall refunds in seconds. Snap a photo of the product made safe, AI checks it, PayPal pays you.";

/** The site's share image: the headline, and the one figure that frames it (CPSC data, plan section 4.6). */
export default async function Image() {
  const fonts = await ogFonts();
  return new ImageResponse(
    (
      <OgFrame foot="Built for the PayPal AI Hackathon, November 2026. Demonstration in PayPal sandbox.">
        <div style={{ display: "flex", flexDirection: "column", width: "100%", justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 118, fontWeight: 300, letterSpacing: -3, lineHeight: 0.95 }}>Recall refunds</div>
          <div style={{ display: "flex", alignItems: "center", fontSize: 118, fontWeight: 300, letterSpacing: -3, lineHeight: 0.95, marginTop: 6 }}>
            <div style={{ display: "flex", width: 210, height: 92, background: C.accent, border: `2px solid ${C.accentEdge}`, borderRadius: 18, marginRight: 30 }} />
            in seconds
          </div>
          <div style={{ display: "flex", fontSize: 32, color: C.muted, marginTop: 36 }}>Snap the product made safe. AI checks it. PayPal pays you.</div>
        </div>
      </OgFrame>
    ),
    { ...OG_SIZE, fonts },
  );
}
