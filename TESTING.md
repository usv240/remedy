# Testing Remedy

Remedy runs on PayPal's sandbox, a practice version of PayPal where no real money moves. You do not need a Remedy account.

- **Hosted demo:** [remedy-y0ym.onrender.com](https://remedy-y0ym.onrender.com), hosted on Render.
- **Start here:** [`/judges`](https://remedy-y0ym.onrender.com/judges) has the five-minute path, the results with their sources, and a guided tour (**Take the 2-minute tour**, six stops in one tab; Escape ends it).

Brightline Home, the firm in the console, is a fictional sample firm. Real CPSC recalls appear with their real data and credited images. Every payout reads "Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm."

## PayPal sandbox buyer login

Use this login in the PayPal window that opens from the sample shop's PayPal button on [`/try/shop`](https://remedy-y0ym.onrender.com/try/shop). The page shows it too.

| | |
|---|---|
| Email | `sb-tvnmx53636325@personal.example.com` |
| Password | `D.}t1I^T` |

- It is a PayPal sandbox personal account. It works only in the sandbox checkout window, and its balance is practice money.
- Please log in rather than paying with a sandbox test card: the sandbox declines test cards at exactly $34.99, the sample product's price.
- Please keep the password as it is so the next person can use it too. The login stays active through the end of judging.

## The five-minute path

The same steps are on `/judges`, with a link to each page.

| # | Page | Time | What to look at |
|---|---|---|---|
| 1 | [`/#showcase`](https://remedy-y0ym.onrender.com/#showcase) | 20 s | Type any product into the headline. The closest recalls answer with what each one asks: what to cut or mark, and the refund. |
| 2 | [`/recalls/27056`](https://remedy-y0ym.onrender.com/recalls/27056) | 40 s | The power bank recall's official remedy, word for word, and the proof rule Claude read from it, with how sure it is of each field. Set **Display** to Technical for the batch trace and the raw CPSC record. |
| 3 | [`/try`](https://remedy-y0ym.onrender.com/try) | 90 s | Run an example through the six checks, or buy in the sample shop, claim, and watch the refund go back to the original PayPal purchase. |
| 4 | [`/firm`](https://remedy-y0ym.onrender.com/firm) | 60 s | The firm's side: the claims queue, the recall plan that updates itself from PayPal's payout events, and the monthly report. |
| 5 | [`/developers`](https://remedy-y0ym.onrender.com/developers) | 40 s | A free key and a live playground. The same search, proof rules and photo checks are tools on the MCP server. |
| 6 | [`/judges#results`](https://remedy-y0ym.onrender.com/judges#results) | 30 s | The CPSC count, the extraction benchmark (draft labels) and the recorded photo checks, each with its source file. |

## Try an example

Open `/try`. The **Examples** tab has four ready-made cases. Press **Run it** on any of them; each one can also be opened on its own page and downloaded as JSON with its photo.

| Example | Recall | What you should see |
|---|---|---|
| The CPSC's own made-safe photo | 26125, hair dryer, cut the cord | A request for the owner's own photo: Remedy recognizes the recall's published example. Press **Run with the official-image match off** to see what the photo checks read: the right product, with the cord cut. |
| The official recall picture | 27056, HAIARA power bank | "Send a photo of your own product." No payout, and no model call: the match with the official picture is found in code. |
| A blurry photo | 27056 | A friendly retake ("hold still and try again"), found before any model call. |
| Something else entirely (a mug) | 27056 | The right-product check does not pass, so there is no payout, and the owner hears what to send instead. |

Examples that need Claude replay one recorded live answer, so pressing **Run it** costs nothing; every check around that answer runs again in code.

**Your own photo:** the **Your photo** tab, or `/claim/27056` on a phone, runs the same claim flow live: the recall, the steps to make it safe, one photo, the six checks, and your result. Photo checks are limited per visitor (6 in 10 minutes, 30 a day); the examples are not.

## Buy, claim and refund to the original purchase (about 3 minutes)

1. Open [`/try/shop`](https://remedy-y0ym.onrender.com/try/shop). Press the PayPal button, log in with the sandbox buyer above, and complete the purchase of the Brightline PowerCell 10K power bank (sample), $34.99 in the sandbox.
2. The page reads **You bought the sample power bank**, with the sandbox capture ID and the date it can be refunded until (PayPal's 180 days). Press **Now claim it**.
3. The claim page for recall 27056 links that purchase for you. Write RECALLED in marker on a power bank or another small device you have, and take or upload one photo. The checks run in a few seconds.
   - A product other than the recalled HAIARA model goes to **firm review**, which is the next step you play. Keep **Back to your PayPal payment** and press **Save where to send it**. The receipt reads **Waiting for Brightline Home**.
   - If the result is a retake, it says exactly what to change; take a new photo.
4. Open [`/firm/claims`](https://remedy-y0ym.onrender.com/firm/claims), choose **Needs review**, open your claim, and press **Approve and pay**. The payment router sees the linked purchase inside 180 days and refunds it to the original PayPal capture.
5. Back on your receipt: **Refunded ... to your PayPal payment**, with the sandbox refund ID.
6. Claim the same purchase again: the second claim is declined, because that purchase is already claimed.

`tests/e2e/claim-shop.mjs` runs this path end to end (10 of 10).

## The firm console

Open [`/firm`](https://remedy-y0ym.onrender.com/firm): Brightline Home's recall card (claims verified, refunds paid, units corrected, days since the announcement), payouts waiting to be accepted, and the next CPSC report.

- [`/firm/claims`](https://remedy-y0ym.onrender.com/firm/claims) is the claims queue in AG Grid: photo, claimant (masked), the six checks, decision, amount and payout status, with quick views and search. On a phone it becomes a card list.
- Open any row: the drawer shows the photo, each check with its reason, and the payment plan. **Ask for a retake** asks the owner, kindly, for a new photo through the same claim link.
- The look-alike claim on recall 26754 (the CPSC's photo of a different hair dryer) shows the **Two reviewers**: the Product reviewer, who sees only the official images, and the Remedy reviewer, who sees only the remedy text. Each cites what it saw, and the referee in code sends the claim to a person.
- **Reviewing as** picks a sample reviewer (Ana or Devon); approvals are recorded in that name.

## Bulk pay

1. In `/firm/claims`, press **Select all ready to pay** (or choose **Ready to pay** and tick the rows).
2. Press **Approve and pay**. The status line reads, for example, "2 payouts sent in PayPal batch ...": one PayPal Payouts batch for all of them.
3. The payout status updates live in the grid ("Live: payout status updates here"). In our runs, a sandbox payout reached SUCCESS 17 to 18 seconds after approval.

The two seeded claims ready to pay are $1.00 each, to the sandbox buyer. If an earlier visitor has paid them, **Ready to pay** is empty; any **Needs review** claim can still be approved and paid from its drawer.

## The recall plan and its re-notice

1. Open [`/firm/plan`](https://remedy-y0ym.onrender.com/firm/plan). The Bryntum Gantt holds Brightline's corrective-action plan: the announcement, notice waves, payout batches, follow-ups and CPSC reports, with their dependencies. Tasks marked sample are fictional history.
2. The line above it reads **Live: new tasks from PayPal appear here**.
3. When PayPal reports a payout waiting to be accepted (sent to an email address with no PayPal account), Remedy adds **Re-notice: payout waiting to be accepted**, linked to its payout batch. The open plan shows "New task: ..." and the new row without a reload.
4. To see one arrive: keep the plan open in one tab, and in another open a **Needs review** claim in `/firm/claims` whose claimant reads `...@example.com`, and press **Approve and pay**. Sample claimants have made-up `example.com` addresses with no PayPal account, so the sandbox holds that payout as unclaimed.
5. Drag a bar, or use **Move a task** below the chart; payout batches and the announcement keep their dates. **Review schedule** (Bryntum Scheduler) shows each open review case by reviewer.

The plan runs on the Bryntum trial, so it shows the trial watermark. `tests/e2e/firm.mjs` checks the live re-notice with a seeded unclaimed event that takes the same path as a PayPal webhook.

## The CPSC monthly report

1. Open [`/firm/reports`](https://remedy-y0ym.onrender.com/firm/reports) and pick a month.
2. The tiles show corrections this period, total corrections, refunds paid and payouts waiting to be accepted. **The CPSC form, filled in** lays the same numbers out under the field names of the CPSC's Monthly Progress Report form, such as "With Consumers: Total Cumulative Corrections for Recall". Every number is counted in SQL; `tests/e2e/firm.mjs` checks them against its own SQL.
3. **Summary** starts as a plain template filled from those numbers. **Write the summary with Claude** has Claude Haiku 5.5 write it once for the month, from the numbers only; if the paragraph uses any figure that is not in the report, the plain template stays.
4. **Print or save as PDF** keeps just the report; **Download CSV** gives the same rows.

## The API with a key

1. Open [`/developers`](https://remedy-y0ym.onrender.com/developers), enter a name and email, accept the sandbox terms, and get a key. It is shown once (`rm_test_` and 43 characters); Remedy stores only its hash. Rotate or revoke it on `/developers/keys`.
2. Limits: 20 requests a minute without a key; 60 a minute and 1,000 a day with one. Each address can create five keys a day.
3. Try three calls (use `http://localhost:3300` in place of the hosted URL when running locally):

```bash
# Search recalls in plain words
curl "https://remedy-y0ym.onrender.com/api/v1/recalls?query=power%20bank&limit=3" \
  -H "Authorization: Bearer rm_test_..."

# One recall's proof rule: write RECALLED on the power bank
curl -X POST https://remedy-y0ym.onrender.com/api/v1/proof-rule \
  -H "content-type: application/json" -d '{"recall_number":"27056"}'

# Verify a photo: here, the recall's own official picture
curl -o official.jpg "https://remedy-y0ym.onrender.com/api/try/presets/official-image/photo?download=1"
curl -X POST https://remedy-y0ym.onrender.com/api/v1/verify \
  -H "Authorization: Bearer rm_test_..." -F photo=@official.jpg -F recall_number=27056
```

The verify answer has `"decision": "retake"` and `"decided_by": "own_photo"`: the recall's own picture is found in code before any AI call. Without a key, `/api/v1/verify` runs only the free checks; with one, the full checks run, up to 25 a day per key. Nothing is stored or paid by this endpoint. Every endpoint, field and error is on [`/developers/docs`](https://remedy-y0ym.onrender.com/developers/docs), and `/openapi.json` has the same description for Postman and code generators.

## MCP

Add Remedy to Claude Code:

```bash
claude mcp add --transport http remedy https://remedy-y0ym.onrender.com/api/mcp
```

Add `--header "Authorization: Bearer rm_test_..."` for full photo checks in `verify_photo`. The tools:

| Tool | What it does |
|---|---|
| `search_recalls` | Finds recalls since 2024 from plain words, each with what to cut or mark and the refund |
| `get_proof_rule` | One recall's proof rule, with the official remedy text it came from |
| `verify_photo` | Checks a photo (URL or base64) against a recall; stores and pays nothing |
| `open_claim` | The owner's claim link and checklist, or, with a photo, opens a claim; never pays |
| `claim_status` | Where a claim stands, with its PayPal status |
| `ping` | Confirms the server is reachable |

Without an MCP client, list the tools with one request:

```bash
curl -X POST https://remedy-y0ym.onrender.com/api/mcp \
  -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Agents can also find the server on their own through `/api/mcp/server-card`, `/.well-known/ai-catalog.json` and `/llms.txt`.

## Run it locally

You need Node.js 24, Docker, a PayPal developer account with a sandbox app, and an Anthropic API key for live photo checks.

```bash
npm ci
docker compose up -d          # Postgres 17 on port 5432
cp .env.example .env.local    # then fill in the values below
npm run db:migrate            # the reviewed schema in db/schema.sql
npm run db:load               # recalls, proof rules and official image hashes
npm run db:seed               # the sample firm
npx tsx --env-file=.env.local scripts/seed-firm.ts   # its sample claims, plan and report history
npm run dev                   # http://localhost:3300
```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Already set for the Docker database |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Your sandbox app: developer.paypal.com > Apps & Credentials > Sandbox |
| `PAYPAL_WEBHOOK_ID` | The sandbox webhook pointed at `https://<host>/api/webhooks/paypal`; without it, payout statuses are read by polling |
| `PAYPAL_VENDOR_EMAIL` | A sandbox business account that stands in for the retailer of a safe replacement |
| `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD` | The sandbox personal account, for the payment suites and the seeded claims ready to pay |
| `ANTHROPIC_API_KEY` | Live photo checks, the two reviewers and the report summary |
| `AI_DAILY_USD` | Daily Claude budget in US dollars ($2 on the hosted site; no limit locally) |
| `ELASTIC_URL`, `ELASTIC_API_KEY` | Elastic recall search; without them, the in-app BM25 search |
| `CHANNEL3_API_KEY` | Safe replacements; without it, owners are offered a refund |
| `NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY` | Removes the AG Grid enterprise license notice |
| `CHECKS_SECRET` | Guards the test-only approval route the claim suites use |
| `DATA_KEY`, `AUDIT_SALT`, `REMEDY_SECRET_KEY` | Encryption and hashing secrets; set long random values when hosted |

`/status` shows whether each integration is live or on its fallback, and today's AI spend.

## Run the tests

Start the app on port 3300 first (or set `BASE_URL`). The browser suites drive Chrome; if Chrome is not at `C:/Program Files/Google/Chrome/Application/chrome.exe`, set `CHROME_PATH`. The claim and firm suites move small amounts of sandbox money ($1.00 to $1.50 a payment, plus one $34.99 sample-shop purchase), and they remove their own test claims afterwards unless you pass `--keep`.

| Suite | Command | Expected |
|---|---|---|
| Types and lint | `npm run typecheck`, `npm run lint` | No errors |
| Unit tests, no network | `npm test` | 308 passed, 27 skipped (the live Claude, live PayPal and Postgres suites skip without keys or a database) |
| Every page and public endpoint, each integration on its fallback | `npm run e2e:smoke` | All pass |
| Accessibility (axe, WCAG 2.2 AA, serious and critical) and sideways scroll: 22 pages, phone and desktop, light and dark | `npm run e2e:a11y` | All 88 page views pass |
| Search relevance, the explorer, the public API with and without a key, OpenAPI, docs and the MCP tools (no AI call) | `node tests/e2e/public.mjs` | All pass |
| The owner's claim: examples, a streamed claim, firm review, approval, a $1.25 sandbox payout and the receipt | `node --env-file=.env.local tests/e2e/claim.mjs` | 23 of 23 |
| Buy in the sample shop as the sandbox buyer, claim, and refund to the original capture | `npx tsx --env-file=.env.local tests/e2e/claim-shop.mjs` | 10 of 10 |
| The firm console: queue and drawer, bulk Approve and pay ($1.00 payouts), the report against SQL, and a live Gantt re-notice (run `scripts/seed-firm.ts` first; `FIRM_E2E_PAY=0` skips the payouts) | `node --env-file=.env.local tests/e2e/firm.mjs` | All pass |
| The audit ledger's hash chain, straight from the database | `npm run verify-ledger` | Every hash links to the one before it |
| 60 ledger appends at once keep one chain | `npm run test:ledger-race` | Chain verified |
| Rescore the extraction benchmark from the stored outputs (no AI call) | `npx tsx scripts/recalls/bench.ts` | Writes `content/recalls/benchmark/results.json`, marked draft until every label is confirmed |
| Recount the CPSC figures | `npx tsx scripts/recalls/stats.ts` | Writes `content/recalls/stats.json`; the 2026-11-01 snapshot gives the published 523 of 1,227 |

The schema is reviewed SQL in `db/schema.sql`, applied with `npm run db:migrate` (safe to run again); `tests/schema.test.ts` checks that it and the Drizzle schema in `src/lib/db/schema.ts` define the same tables and columns.

## If something looks off

- **The PayPal window does not appear:** allow pop-ups for the site, then press the button again.
- **A sandbox card is declined at $34.99:** that is a sandbox rule for test cards at that amount. Log in with the sandbox buyer instead.
- **"That is a lot of photos in a few minutes":** photo checks are limited per visitor. Wait a little, or run an example on `/try`, which has no limit.
- **A photo goes to firm review instead of being checked by Claude:** the hosted site's daily AI budget may be used up. The free checks still run, and a person at the firm can approve it in `/firm/claims`.
- **A payout reads "Waiting to be accepted":** the email has no PayPal sandbox account, so PayPal holds the payout. The plan adds a friendly re-notice.
- **A new purchase is not in `/firm/buyers` yet:** PayPal's sandbox can take up to three hours to list a new transaction in Transaction Search.
- **An API call answers 429:** wait a minute, or use a free key for higher limits.
- **A trial watermark on the plan, or a license notice on the grid:** Bryntum runs on its trial, and AG Grid's enterprise features show a notice until a license key is set.
