# Run it yourself, and the tests

Part of the [Remedy README](../README.md). Every suite and the command that runs it; [TESTING.md](../TESTING.md) has the sandbox accounts and step-by-step checks.

## Run it yourself

You need Node 24 and Docker.

```bash
git clone https://github.com/usv240/remedy
cd remedy
npm ci                        # also copies Bryntum Gantt's script into public/bryntum/
cp .env.example .env.local    # fill in what you have; DATABASE_URL is the only one required
docker compose up -d          # Postgres 17 on port 5432
npm run db:migrate            # applies the reviewed schema in db/schema.sql
npm run db:load               # loads content/recalls/: recalls, proof rules and image hashes
npm run db:seed               # the sample firms, Brightline Home and Fernway Home
npx tsx --env-file=.env.local scripts/seed-firm.ts   # its sample claims, plan and report history
npm run dev                   # http://localhost:3300
npm run worker                # the job worker, in a second terminal (without it, routes run their jobs inline after 2 s)
```

### PayPal keys

PayPal payments (payouts, refunds, the sample shop) need PayPal sandbox keys, free from PayPal in three steps:

1. Sign in at [developer.paypal.com](https://developer.paypal.com) and open **Apps & Credentials** in **Sandbox** mode.
2. Create a sandbox app; its page shows a **Client ID** and a **Secret**.
3. Put them in `.env.local` as `PAYPAL_CLIENT_ID=` and `PAYPAL_CLIENT_SECRET=`, and restart `npm run dev`. The sample shop's checkout button reads the same Client ID from `NEXT_PUBLIC_PAYPAL_CLIENT_ID=`.

`PAYPAL_ENV` (default `sandbox`) picks the PayPal every call uses, from one place, `src/lib/paypal/env.ts`: the REST API, the Server SDK, the sample shop's JavaScript SDK and PayPal's MCP server. Going live is `PAYPAL_ENV=live` with a live app's client ID, secret and webhook ID. Every PayPal call has a 15-second timeout; a call that times out is sent once more only where that cannot pay twice (a read, the token request, or a write with its `PayPal-Request-Id`), in `src/lib/paypal/http.ts`.

Bryntum Gantt runs its trial build, and without an AG Grid key the claims queue runs AG Grid Community.

For a production build: `npm run build`, then `PORT=3400 npm start`. On Render, `render.yaml` adds the worker as a background service with the same environment, plus `SENTRY_DSN` for error tracking (optional). Every service except Postgres is optional: without its key, each one uses a fallback, and `/status` says which. [TESTING.md](../TESTING.md) covers the sandbox accounts and every suite.

To host your own copy on Render, [`render.yaml`](../render.yaml) creates the web service and its database:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/usv240/remedy)

## Tests

Every push to `main` runs [CI](../.github/workflows/ci.yml): the dependency audit, types, lint and the unit tests, then a production build served against an empty Postgres with no service keys, where every page must answer and pass axe. The suites that move sandbox money need keys: [Sandbox money, end to end](../.github/workflows/sandbox-e2e.yml) runs the claim payout and the one-click payout on demand (Actions > Run workflow) once the repository holds the three sandbox secrets named at the top of that file, and stops with a plain message when it does not; every suite also runs from a machine with keys.

| Suite | Command | Result |
|---|---|---|
| Unit tests: proof rules, the classifier and stats, search, the six checks and the decision, perceptual hashing, the verification cache and spend guard, payments and webhooks, the firm console, the API and MCP, encryption | `npm test` | 630 passed, 51 skipped: 21 need a database, 28 a Claude key and 2 PayPal sandbox keys (counted by what each needs in `content/public/facts.json`) |
| Every page and public endpoint, each integration on its fallback | `npm run e2e:smoke` | All pass |
| Accessibility (axe, WCAG 2.2 AA) and sideways scroll, 32 pages at phone and desktop width, light and dark | `npm run e2e:a11y` | 128 of 128 page views |
| Search relevance, the explorer, the public API with and without a key, OpenAPI, and the MCP tools | `node tests/e2e/public.mjs` | All pass |
| One photo, two firms: the cross-firm hash check, recorded with no model call | `npx tsx scripts/public/record-network-run.ts` | [`content/public/network-run.json`](../content/public/network-run.json); `tests/network-run.test.ts` runs it again |
| Another firm joins the hash pool: register, a hit, a no-hit, made with curl from outside the app against the local build with a sandbox key | `REMEDY_DEV_KEY=rm_test_... BASE_URL=http://localhost:3400 npx tsx scripts/public/record-hash-pool-call.ts` | [`content/public/hash-pool-call.json`](../content/public/hash-pool-call.json); `tests/hash-pool.test.ts` runs the same comparison with no database |
| The hash against a reused photo: 9 photos, 13 changes each, caught at 10 and 4 bits, false matches against the catalog | `npx tsx scripts/public/hash-reuse-run.ts` | [`content/public/hash-reuse-run.json`](../content/public/hash-reuse-run.json); `tests/hash-reuse-run.test.ts` makes the copies again |
| The owner's claim: presets, a streamed claim, firm review, approval, a real sandbox payout and the receipt | `node --env-file=.env.local tests/e2e/claim.mjs` | 23 of 23; the run's steps and PayPal ids in [`content/public/e2e-transcript.json`](../content/public/e2e-transcript.json) |
| Buy in the sample shop, claim, and refund to the original capture | `npx tsx --env-file=.env.local tests/e2e/claim-shop.mjs` | 11 of 11; transcribed in the same file |
| The firm console: queue and drawer, bulk Approve and pay, the report against SQL, and a live Gantt re-notice | `node --env-file=.env.local tests/e2e/firm.mjs` | All pass |
| Is it recalled? The label check over every recall that lists a model number or UPC, and products no recall lists, with no AI call | `npx tsx scripts/label/eval-catalog.ts` | Found the right recall for 2,201 of 2,216 label readings; 511 of 511 not-recalled products matched no recall. [`content/public/label-eval.json`](../content/public/label-eval.json); `tests/label-eval.test.ts` runs a slice again |
| The label check on 30 real label photos, answers written down first (prepared; reads each with Claude under `--max-usd`) | `npx tsx --env-file=.env.local scripts/label/eval-photos.ts` | Plan and estimate (about $0.77); [`content/label/photo-eval-cases.json`](../content/label/photo-eval-cases.json) |
| The audit ledger's hash chain | `npm run verify-ledger` | Every hash links to the one before it |
| The figures the README, these pages and TESTING.md repeat, counted after the suites run | `npx tsx scripts/facts.ts` | [`content/public/facts.json`](../content/public/facts.json); `tests/facts.test.ts` fails when the README, `docs/*.md` or TESTING.md disagree with it |
| 100 visitors at once on the free paths, against the production build | `node --env-file=.env.local scripts/load-test.mjs` | p50, p95, p99 and the error rate per path on `/evidence/operations#load` |
| 60 ledger appends at once | `npm run test:ledger-race` | Chain verified |
