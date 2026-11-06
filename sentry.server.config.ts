// Error tracking on the server, on only when SENTRY_DSN is set (src/lib/sentry.ts holds the shared options).
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./src/lib/sentry";

const opts = sentryOptions();
if (opts) Sentry.init(opts);
