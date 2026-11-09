# Testing Remedy

Remedy runs on PayPal's sandbox, a practice version of PayPal where no real money moves. You do not need a Remedy account.

- **Hosted demo:** [remedy-y0ym.onrender.com](https://remedy-y0ym.onrender.com), hosted on Render.
- **Start here:** press **Try a photo** on the [home page](https://remedy-y0ym.onrender.com) (it opens [`/try`](https://remedy-y0ym.onrender.com/try)) and press **Run it** on the first photo, Brightline's sample charger with its cord cut. Then [`/evidence`](https://remedy-y0ym.onrender.com/evidence) has the longer path below, the results with their sources, and a guided tour (**Take the 2-minute tour**, six stops in one tab; Escape ends it).

Brightline Home, the firm in the console, is a fictional sample firm, and so is Fernway Home, whose sample recall FW-2026-01 shows the hash check across firms. Real CPSC recalls appear with their real data and credited images. Every payout reads "Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm."

## PayPal sandbox buyer login

Use this login in the PayPal window that opens from the sample shop's PayPal button on [`/try/shop`](https://remedy-y0ym.onrender.com/try/shop). The page shows it too.

| | |
|---|---|
| Email | `sb-tvnmx53636325@personal.example.com` |
| Password | `D.}t1I^T` |

- It is a PayPal sandbox personal account. It works only in the sandbox checkout window, and its balance is practice money.
- Please log in rather than paying with a sandbox test card: the sandbox declines test cards at exactly $34.99, the sample product's price.
- Please keep the password as it is so the next person can use it too. The login stays active.

## The longer path, about five minutes

The same steps are on `/evidence`, with a link to each page. The first is the same first step as everywhere else.

| # | Page | Time | What to look at |
|---|---|---|---|
| 1 | [`/try`](https://remedy-y0ym.onrender.com/try) | 90 s | Run Brightline's sample charger with its cord cut through the six checks: verified. Or buy the charger in the sample shop, claim it with the sample photo, and watch the refund go back to the original PayPal purchase. A paid receipt without sending a payout: [`/r/recorded`](https://remedy-y0ym.onrender.com/r/recorded). |
| 2 | [`/#showcase`](https://remedy-y0ym.onrender.com/#showcase) | 20 s | Type any product into the headline. The closest recalls answer with what each one asks: what to cut or mark, and the refund. |
| 3 | [`/recalls/27056`](https://remedy-y0ym.onrender.com/recalls/27056) | 40 s | The power bank recall's official remedy, word for word, and the proof rule Claude read from it, with how sure it is of each field. Press **Switch to Technical** (top right) for the batch trace and the raw CPSC record. |
| 4 | [`/firm`](https://remedy-y0ym.onrender.com/firm) | 60 s | The firm's side: the claims queue, the recall plan that updates itself from PayPal's payout events, and the monthly report. |
| 5 | [`/developers`](https://remedy-y0ym.onrender.com/developers) | 40 s | A free key and a live playground, and a recorded session of an AI assistant using the MCP tools to find a recall and open a claim. |
| 6 | [`/evidence#results`](https://remedy-y0ym.onrender.com/evidence#results) | 30 s | The CPSC count, the extraction benchmark (draft labels) and the recorded photo checks, each with its source file. |

## Try an example

Open `/try`. The **Examples** tab starts with **Photos of products made safe**: one real charger, photographed before and after its cord was cut, for Brightline Home's sample recall BH-2026-01. Below it, **Photos that are asked for again**. Every example shows its expected result; press **Run it** and the run says whether it matched. Each runnable example can also be opened on its own page and downloaded as JSON with its photo.

| Example | Recall | Expected result |
|---|---|---|
| Brightline's sample charger, cord cut | Sample recall BH-2026-01 | **Verified** in this recorded run. The product match is just under the pass mark, so two AI reviewers look; both find the charger with its cord cut. Across its 4 recorded runs: verified 3 times, and sent to a person at the firm once. $34.99 is under Brightline's $50.00 auto-approve cap, so a verified claim is refunded at once. |
| The same charger, opened, cord still attached | BH-2026-01 | **Retake:** cut the cord first. Shown with its three measured runs (a retake in each), not run again. |
| The same charger, taken apart | BH-2026-01 | **Retake:** the cord is still wired in. Three measured runs, a retake in each. |
| The CPSC's own made-safe photo | 26125, hair dryer, cut the cord | **Retake:** Remedy recognizes the recall's published example in code and asks for the owner's own photo. Press **Run with the official-image match off** to see what the photo checks read: the right product, and Claude noting it is the CPSC's own published picture rather than the owner's photo. No payout either way. |
| The official recall picture | 27056, HAIARA power bank | **Retake:** "Send a photo of your own product." No model call: the match with the official picture is found in code. |
| A blurry photo | 27056 | **Retake:** "hold still and try again", found before any model call. |
| Something else entirely (a mug) | 27056 | **Retake:** the right-product check does not pass, and the owner hears what to send instead. |
| A different power bank (Oraimo) | 27056 | **Retake:** a different model, so the right-product check does not pass. |
| A look-alike with a 20 on it (Romoss) | 27056 | **Retake:** a similar print is not enough; the right-product check does not pass. |
| A photo of a screen | 27056 | **Retake:** the own-photo check sees a computer monitor, so the owner is asked for a photo of the product itself. |

Examples that need Claude replay one recorded live answer, so pressing **Run it** costs nothing; every check around that answer runs again in code.

**Run it live:** Brightline's sample charger also has **Run it live**, which sends the photo to Claude Opus 5.5 now, with the verification cache skipped so the answer is new, and labels the result **Live** with what it cost. Each visitor gets one live run a day, paid from the site's daily AI budget (`AI_DAILY_USD`); when the budget is spent, the server has no Claude key, or the visitor has used theirs, it shows the recorded run, labelled **Recorded** with the reason. Nothing is paid from `/try`. Photos of products the team owns are added under **Photos of products made safe** when they are in `content/verify/fixtures/user/` with an `expected.json`.

**A remedy that asks for more than one photo:** 8 of the 525 photo-refund recalls do, and their claim pages take that many. Open [`/claim/25007`](https://remedy-y0ym.onrender.com/claim/25007): **Snap two photos**, the straps cut off, then the helmet in the trash. Each photo gets the free checks, and both go to Claude in one request.

**Your own photo:** the **Your photo** tab, or `/claim/27056` on a phone, runs the same claim flow live: the recall, the steps to make it safe, one photo, the six checks, and your result. Photo checks are limited per visitor (6 in 10 minutes, 30 a day); the examples are not.

## Buy, claim and refund to the original purchase (about 3 minutes)

1. Open [`/try/shop`](https://remedy-y0ym.onrender.com/try/shop): **Buy the sample charger**. The product is the **Brightline 65W laptop charger (sample)**, $34.99, sold by Brightline Home (sample) and recalled in Brightline's own sample recall, BH-2026-01. Press the PayPal button, log in with the sandbox buyer above, and complete the purchase.
2. The page reads **You bought the sample charger.**, with $34.99, the date, the sandbox capture ID and the date it can be refunded to this payment until (PayPal's 180 days). Press **Now claim it**.
3. The claim page for recall BH-2026-01 opens: **Get your refund**, "For the recalled Brightline 65W laptop charger. Make it safe, snap one photo, and PayPal pays you a full refund of $34.99." The steps are to unplug the charger, cut the cord where it meets the charger case, and take one photo of the cut cord with the charger.
4. Under **Bought it from Brightline with PayPal?**, **Use my purchase from** your purchase date, **$34.99, made on this device** is ticked, so the refund goes back to it.
5. No charger to cut? Press **Use Brightline's sample photo**: the public-domain photo of this charger with its cord cut (Dmitry G, Wikimedia Commons). Or take your own. Press **Check my photo**.
6. The six checks run and the result reads **Verified**, **Your photo checks out.**, $34.99 refund. Under **Where should it go?**, **Back to your PayPal payment** is chosen. Press **Send my refund**.
7. $34.99 is under Brightline's $50.00 auto-approve rule, and within its auto-pay limit of $350.00 a day for this recall, so no person is needed: the payment router sees the purchase inside 180 days and refunds it to the original PayPal capture. The receipt reads **Refunded $34.99 to your PayPal payment.**, with the sandbox refund ID.
8. Claim the same purchase again: the claim page says that purchase already has a claim, and the new claim is checked on its own, with no second refund to that purchase.

The sample photo can be used by every visitor: it stays out of the earlier-claims pool. Any other photo is checked against earlier claims as usual, so a photo already used is asked again. With a photo of a product that is not the recalled charger made safe, the result is a friendly retake, or **firm review** when a check is unclear; a firm review claim is approved in [`/firm/claims`](https://remedy-y0ym.onrender.com/firm/claims) (choose **Needs review**, open it, **Approve and pay**), and the refund then goes back to the purchase the same way.

`tests/e2e/claim-shop.mjs` runs this path end to end (11 of 11).

## The firm console

Open [`/firm`](https://remedy-y0ym.onrender.com/firm): Brightline Home's recall card (claims verified, refunds paid, units corrected, days since the announcement), payouts waiting to be accepted, and the next CPSC report.

- [`/firm/claims`](https://remedy-y0ym.onrender.com/firm/claims) is the claims queue in AG Grid: photo, claimant (masked), the six checks, decision, amount and payout status, with quick views and search. On a phone it becomes a card list.
- Open any row: the drawer shows the photo, each check with its reason, and the payment plan. **Ask for a retake** asks the owner, kindly, for a new photo through the same claim link.
- The look-alike claim on recall 26754 (the CPSC's photo of a different hair dryer) shows the **Two reviewers**: the Product reviewer, who sees only the official images, and the Remedy reviewer, who sees only the remedy text. Each cites what it saw, and the referee in code sends the claim to a person.
- **Sign in as Ana (sample reviewer)**, above the queue or in a claim's drawer, is one click; approving a payout and asking for a retake wait for it, and are recorded in Ana's name. There is no real account behind it (the info button's Technical view says so); a firm's own deployment signs in through PayPal's Partner Referrals onboarding.
- **Payments and claim limits**, on [`/firm`](https://remedy-y0ym.onrender.com/firm): the PayPal account the firm pays from, and the claim limits as plain rules. **Connect your PayPal app** takes a sandbox REST app's client ID and secret and checks them with PayPal; a firm's own console stores them sealed and pays its refunds and payouts from them, while this open sample console only checks them and keeps the platform's sandbox account. The limits: one refund per person per recall, where a person is the payee, the PayPal purchase, the PayPal account that paid, or the network and browser (a new email alone does not reset it), and the auto rule pays at most $350.00 a day for each recall, with the rest waiting in **Needs review**.
- Sample claims show the sample set's own photos of the charger (Dmitry G, Wikimedia Commons, public domain): cut for the paid and reviewed claims, intact or opened for the ones asked for a new photo.

## Bulk pay

1. In `/firm/claims`, press **Select all ready to pay** (or choose **Ready to pay** and tick the rows).
2. Press **Sign in as Ana (sample reviewer)** if you have not yet, then **Approve and pay**. The status line reads, for example, "2 payouts sent in PayPal batch ...": one PayPal Payouts batch for all of them.
3. The payout status updates live in the grid ("Live: payout status updates here"). In our runs, a sandbox payout reached SUCCESS 16 to 19 seconds after approval.

Two sample claims are always ready to pay, at the recall's refund of $34.99, to the sandbox buyer: when a visitor has paid them, the queue adds two more the next time it opens. Any **Needs review** claim can also be approved and paid from its drawer.

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

A whole catalog goes in one call: `curl -s .../api/v1/scan/sample | curl -s -X POST .../api/v1/scan -H "content-type: application/json" -d @-` returns each row as `photo_refund`, `recalled`, `clear` or `unknown` with the recall and the claim link (50 rows without a key, 500 with one; `?format=csv` for a file). A product page can show a recall badge with one iframe, `<iframe src=".../api/embed/badge?recall=27056">`, or `?q=power%20bank` for the best-matching recall; `/api/embed/badge.js` with `data-recall="27056"` inserts the same iframe. "Find your recall" and `GET /api/v1/recalls?query=` ask the FDA and NHTSA as a second tier when the CPSC search has no good hit (try `infant formula` and `airbag`); those hits are labelled and link to the agency, since Remedy automates photo refunds for CPSC recalls only.

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
| `scan_catalog` | Checks a list of products at once: photo_refund, recalled, clear or unknown per row, with the claim link |
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

A recorded session of these tool calls, from finding the recall through verify_photo to a claim ready to pay, is on [`/developers`](https://remedy-y0ym.onrender.com/developers#mcp-h) (`content/public/mcp-session.json`). To record it again against a running server, with no AI call: `BASE_URL=http://localhost:3300 node --env-file=.env.local scripts/public/record-mcp-session.mjs` (start the server with `ANTHROPIC_API_KEY=` empty to be sure; the claim it opens is removed afterwards).

Agents can also find the server on their own through `/api/mcp/server-card`, `/.well-known/ai-catalog.json` and `/llms.txt`.

## Run it locally

You need Node.js 24, Docker, a PayPal developer account with a sandbox app, and an Anthropic API key for live photo checks.

```bash
npm ci
docker compose up -d          # Postgres 17 on port 5432
cp .env.example .env.local    # then fill in the values below
npm run db:migrate            # the reviewed schema in db/schema.sql
npm run db:load               # recalls, proof rules and official image hashes
npm run db:seed               # the sample firms, Brightline Home and Fernway Home
npx tsx --env-file=.env.local scripts/seed-firm.ts   # its sample claims, plan and report history
npm run dev                   # http://localhost:3300
npm run worker                # the job worker, in a second terminal (photo checks and payouts; without it, routes run their jobs inline after 2 s)
```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Already set for the Docker database |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Your sandbox app: developer.paypal.com > Apps & Credentials > Sandbox |
| `PAYPAL_WEBHOOK_ID` | The sandbox webhook pointed at `https://<host>/api/webhooks/paypal`; without it, payout statuses are read by polling |
| `PAYPAL_VENDOR_EMAIL` | A sandbox business account that stands in for the retailer of a safe replacement |
| `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD` | The sandbox personal account, for the payment suites and the seeded claims ready to pay |
| `ANTHROPIC_API_KEY` | Live photo checks, the two reviewers and the report summary |
| `AI_DAILY_USD` | Daily Claude budget in US dollars ($5 on the hosted site; no limit locally) |
| `ELASTIC_URL`, `ELASTIC_API_KEY` | Elastic recall search; without them, the in-app BM25 search |
| `CHANNEL3_API_KEY` | Safe replacements; without it, owners are offered a refund |
| `NEXT_PUBLIC_AG_GRID_LICENSE_KEY` | AG Grid Enterprise license for the claims queue; a valid key adds set filters, the column menu and the status bar, and without one the queue runs on AG Grid Community |
| `CHECKS_SECRET` | Guards the test-only approval route the claim suites use |
| `DATA_KEY`, `AUDIT_SALT`, `REMEDY_SECRET_KEY` | Encryption and hashing secrets; set long random values when hosted |

`/status` shows whether each integration is live or on its fallback, and today's AI spend.

## Run the tests

Start the app on port 3300 first (or set `BASE_URL`), and the worker (`npm run worker`) so the claim suites run their checks and payouts through the queue as production does. The browser suites drive Chrome; if Chrome is not at `C:/Program Files/Google/Chrome/Application/chrome.exe`, set `CHROME_PATH`. The claim and firm suites move small amounts of sandbox money ($1.00 to $1.50 a payment, plus one $34.99 sample-shop purchase), and they remove their own test claims afterwards unless you pass `--keep`.

| Suite | Command | Expected |
|---|---|---|
| Types and lint | `npm run typecheck`, `npm run lint` | No errors |
| Unit tests, no network | `npm test` | 593 passed, 51 skipped: 21 need a database, 28 a Claude key and 2 PayPal sandbox keys (counted by what each needs in `content/public/facts.json`) |
| The logger's masking, the rate-limit table and the job queue's retry and dead letter | `npx vitest run tests/log.test.ts tests/ratelimit.test.ts tests/jobs.test.ts` (with `DATABASE_URL` for the Postgres parts) | All pass |
| A person in the photo (a retake, the photo deleted at once), the stored copy's missing EXIF and GPS, and the 90-day photo prune | `npx vitest run tests/photo-privacy.test.ts` (with `DATABASE_URL` for the deletion and prune on the real tables) | All pass |
| Every page and public endpoint, each integration on its fallback | `npm run e2e:smoke` | All pass |
| Accessibility (axe, WCAG 2.2 AA, serious and critical) and sideways scroll: 32 pages, phone and desktop, light and dark | `npm run e2e:a11y` | All 128 page views pass |
| Search relevance, the explorer, the public API with and without a key, OpenAPI, docs and the MCP tools (no AI call) | `node tests/e2e/public.mjs` | All pass |
| The owner's claim: examples, a streamed claim, firm review, approval, a $1.25 sandbox payout and the receipt | `node --env-file=.env.local tests/e2e/claim.mjs` | 23 of 23 |
| Buy in the sample shop as the sandbox buyer, claim, and refund to the original capture | `npx tsx --env-file=.env.local tests/e2e/claim-shop.mjs` | 11 of 11 |
| The firm console: queue and drawer, bulk Approve and pay ($34.99 payouts), the report against SQL, and a live Gantt re-notice (run `scripts/seed-firm.ts` first; `FIRM_E2E_PAY=0` skips the payouts) | `node --env-file=.env.local tests/e2e/firm.mjs` | All pass |
| The audit ledger's hash chain, straight from the database | `npm run verify-ledger` | Every hash links to the one before it |
| 60 ledger appends at once keep one chain | `npm run test:ledger-race` | Chain verified |
| 100 visitors at once on the free paths (official-picture claim, search, scan sample), against the production build on port 3400 | `BASE_URL=http://localhost:3400 node --env-file=.env.local scripts/load-test.mjs` | Writes `content/public/load-test.json`, shown on `/evidence/operations#load`; 0 errors |
| Rescore the extraction benchmark from the stored outputs (no AI call) | `npx tsx scripts/recalls/bench.ts` | Writes `content/recalls/benchmark/results.json`, marked draft until every label is confirmed |
| The figures the README, `docs/*.md`, TESTING.md and `/evidence` repeat, after the suites above | `npx tsx scripts/facts.ts` | Writes `content/public/facts.json`; `tests/facts.test.ts` fails when a document or the code disagrees with it |
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
- **A trial watermark on the plan, or a license notice on the grid:** Bryntum runs on its trial. AG Grid's Enterprise features switch on only with a valid license key, so the queue shows no AG Grid notice without one.
