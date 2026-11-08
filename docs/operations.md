# Running it for real

Part of the [Remedy README](../README.md). What the demo runs on today, what a production deployment changes, and how photos, contact details and money are kept safe.

## The demo today, and a real deployment

What the demo runs on today, and what a production deployment changes. Stated as an operating range; live health is on [`/ops`](https://remedy-y0ym.onrender.com/ops) and the load test on [`/evidence/operations#load`](https://remedy-y0ym.onrender.com/evidence/operations#load).

| Part | The demo today | A real deployment |
|---|---|---|
| Web service | One Render Starter instance (0.5 CPU, 512 MB), always on, with the API and MCP server in the same process | Two or more instances behind Render's load balancer, autoscaling on CPU, the same code |
| Checks and payouts | One background worker (`scripts/worker.ts`); a route runs its own job inline if no worker answers in 2 s | Workers scaled with the queue depth shown on `/ops`; the same `job` table |
| Database | A 256 MB Postgres with a 1 GB disk, reached only from this workspace | A larger Postgres with a connection pooler, point-in-time recovery, and backups restored on a schedule to prove they work |
| Your photo | Stored in Postgres as a 1,600 px copy with no EXIF or GPS data, the original cleared once checked; a photo that shows a person deleted at once, every owner's photo 90 days after the decision, its hash kept | Object storage with signed URLs for upload and view, the same deletion rules, the hash kept in Postgres |
| AI | $5 of Claude a day (`AI_DAILY_USD` in [`render.yaml`](../render.yaml)); past it, photos go to a person at the firm | A budget per firm, the Message Batches API for proof rules, the same cache so a repeat photo costs nothing |
| Firm console | Open, for the fictional sample firm | Login and roles per firm (reviewer, compliance lead, read only), every action in the ledger under a named person |
| PayPal | Sandbox: the sample firm on the platform's app; a firm can connect its own app, sealed, and pay from it | Each firm on its own live PayPal app, and a registered webhook per environment, the same signature check |
| Limits | 20 API requests a minute without a key, 300 photo claims a day site-wide, each payment under $50 | Limits per firm and per key, set with the firm, counted in the same table |

**Observability.** Every API request runs inside a request context ([`src/lib/log.ts`](../src/lib/log.ts)): one JSON log line with the request id, route, status and duration, a row in `request_log`, and `x-request-id` on the response (an incoming `x-request-id` is honored). Every error message ends with its request id, and [`/ops`](https://remedy-y0ym.onrender.com/ops) traces an id to its log lines and ledger entries. Errors go to Sentry when `SENTRY_DSN` is set, with personal data scrubbed first ([`src/lib/sentry.ts`](../src/lib/sentry.ts)); without it, nothing changes. Rate limits live in the `rate_limit` table, so they hold across instances and deploys. Photo checks and payouts run as jobs ([`src/lib/jobs`](../src/lib/jobs)): a worker takes each one with `for update skip locked`, retries with exponential backoff up to five times, and leaves a failed job with its error for a person; `/status` and `/ops` show the queue and the worker's heartbeat.

## Security and privacy

- **Your photo.** The stored copy is re-encoded by sharp at 1,600 px and carries no EXIF or GPS metadata (a unit test checks it); the untouched upload is cleared once the checks have run. When the vision check sees a person (a face, a body, a child), the owner is asked for a photo of the product alone and the photo is deleted at once. Every owner's photo is deleted 90 days after its claim is decided, by the same housekeeping path that prunes the rate-limit and request-log tables. The SHA-256 and perceptual hash stay, so the earlier-claim check still works, and each deletion writes a ledger entry with no image data ([`src/lib/ops/photos.ts`](../src/lib/ops/photos.ts)).
- **Contact details are encrypted at rest** (AES-256-GCM, [`src/lib/secure.ts`](../src/lib/secure.ts)), matched by a keyed hash, and shown masked. Where each payout goes is sealed inside its payment plan the same way ([`src/lib/payments/seal.ts`](../src/lib/payments/seal.ts)).
- **Between firms, only a hash.** The check against photos claimed on other recalls compares 64-bit perceptual hashes only; no firm sees another firm's photo, claimant or recall ([`src/lib/verify/dhash.ts`](../src/lib/verify/dhash.ts)).
- **Tokens are stored only as hashes.** API keys are shown once and kept as SHA-256; personal claim links keep only a fingerprint; visitor addresses in the request log are hashed with a server secret.
- **Webhooks are signature-verified** with PayPal before they change a payment; untrusted events are stored and ignored, and each event id is handled once.
- **Rate limits:** 20 API requests a minute without a key; 60 a minute and 1,000 a day with one; at most 25 full photo checks a key a day; photo claims capped per visitor (6 in 10 minutes, 30 a day) and at 300 a day site-wide; five new keys a day per address.
- **Spend guard:** the daily AI budget above, and payment limits for the public sandbox demo: each payment at most $50, and $500 a day. The firm's auto rule pays at most its daily limit for each recall; past it, verified claims wait for a person.
- **One person, many claims:** the claim limit counts every identity a claim carries (payee, PayPal purchase, paying PayPal account, and a keyed hash of the network address and browser), each kept only as a hash ([`src/lib/firm/limits.ts`](../src/lib/firm/limits.ts), tested with the new-email case in [`tests/firm-limits.test.ts`](../tests/firm-limits.test.ts)). The sandbox buyer login TESTING.md publishes is shared by every tester, so it is not taken as one person.
- **An audit ledger anyone can check:** claims, payment status changes and webhook events are chained by SHA-256, appends take a Postgres advisory lock, and `GET /api/ledger/verify` recomputes the chain.
