// Error tracking in the browser, on only when NEXT_PUBLIC_SENTRY_DSN is set at build time. Without a DSN the SDK is
// never loaded, so nothing changes. Nothing personal leaves the page: no default PII, and beforeSend scrubs the rest.
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

let transition: ((href: string, navigationType: string) => void) | null = null;

if (DSN) {
  void Promise.all([import("@sentry/nextjs"), import("./lib/sentry")]).then(([Sentry, { sentryOptions }]) => {
    const opts = sentryOptions(DSN);
    if (!opts) return;
    Sentry.init({ ...opts, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 });
    transition = Sentry.captureRouterTransitionStart;
  });
}

export function onRouterTransitionStart(href: string, navigationType: string) {
  transition?.(href, navigationType);
}
