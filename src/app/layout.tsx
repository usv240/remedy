import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PREFS_SCRIPT, PrefsProvider } from "@/components/prefs";
import { Reveal } from "@/components/Reveal";
import { StackStrip } from "@/components/StackStrip";
import { Tour } from "@/components/tour/Tour";
import "./globals.css";
import "./site.css";
import "./components.css";

/** Sentient (Indian Type Foundry, ITF Free Font License), self-hosted: the dealt face for display and running text. */
const sentient = localFont({
  src: [
    { path: "./fonts/Sentient-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Sentient-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Sentient-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/Sentient-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-sentient",
  display: "swap",
});

/** IBM Plex Sans (SIL Open Font License): app screens, tables and figures, which need tabular numerals. */
const plex = localFont({
  src: [
    { path: "./fonts/IBMPlexSans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexSans-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexSans-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  // Render sets RENDER_EXTERNAL_URL to the service's public address.
  metadataBase: new URL(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3300"),
  title: { default: "Remedy: recall refunds in seconds", template: "%s | Remedy" },
  description: "Snap a photo of a recalled product made safe. Remedy checks it against the official CPSC recall and PayPal pays the refund, so recalled products leave homes faster.",
};

export const viewport: Viewport = {
  // Light is the default theme; Dark and System are a choice in the Display menu.
  themeColor: "#f4f5f0",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sentient.variable} ${plex.variable}`} data-theme="light" data-text="standard" data-labels="off" data-mode="plain" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      </head>
      <body>
        <PrefsProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <Header />
          <main id="main">{children}</main>
          <StackStrip />
          <Footer />
          <Suspense fallback={null}>
            <Reveal />
          </Suspense>
          <Suspense fallback={null}>
            <Tour />
          </Suspense>
        </PrefsProvider>
      </body>
    </html>
  );
}
