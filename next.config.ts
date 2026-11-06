import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  poweredByHeader: false,
  // Headers that hold with PayPal's checkout popup, AG Grid, AG Studio and Bryntum: no framing by other sites, no
  // plugins, no MIME sniffing, HTTPS remembered for two years, and popups (PayPal's) keep their link back to this page.
  // The camera is allowed for this site only, so an owner can take the photo in the page.
  // The domain's AI Catalog lives at the well-known path (SEP-2127 discovery); the route serves it.
  async rewrites() {
    return [{ source: "/.well-known/ai-catalog.json", destination: "/api/ai-catalog" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  // scripts/build.mjs sets this so a build machine with many CPUs does not start one worker per CPU.
  experimental: process.env.NEXT_BUILD_CPUS ? { cpus: Number(process.env.NEXT_BUILD_CPUS) } : undefined,
  turbopack: {
    // Bryntum's trial bundle stays out of the bundle; the page loads it as a script (scripts/vendor-bryntum.mjs).
    resolveAlias: { "@bryntum/gantt": "./src/components/gantt/bryntum-global.cjs" },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
