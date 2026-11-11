# Remedy

[![CI](https://github.com/usv240/remedy/actions/workflows/ci.yml/badge.svg)](https://github.com/usv240/remedy/actions/workflows/ci.yml) [![Sandbox-payouts](https://github.com/usv240/remedy/actions/workflows/sandbox-e2e.yml/badge.svg)](https://github.com/usv240/remedy/actions/workflows/sandbox-e2e.yml)

<p>
  <img src="docs/img/strip-1-claim.png" alt="An owner's claim page on a phone" height="300">
  <img src="docs/img/strip-2-receipt.png" alt="The owner's PayPal refund receipt" height="300">
  <img src="docs/img/strip-3-queue.png" alt="The firm's claims queue" height="300">
</p>

Remedy pays a recall refund through PayPal once one photo shows the recalled product made safe. It is for the owners of recalled products and the firms that recall them. Start at [remedy-y0ym.onrender.com](https://remedy-y0ym.onrender.com) and press **Try a photo**.

Since January 2024, **447** US consumer product recalls refund an owner who sends a photo of the product made safe, **$471.1 million** in refunds at the lowest stated price, and a recall claim portal today pays by check within 10 to 15 business days. The owner makes it safe as the recall asks and snaps one photo; Remedy checks it against the official recall, and PayPal pays, back to the original purchase or as a payout to an email, a phone or Venmo (in the sandbox, a PayPal payout to that phone number stands in for Venmo).

- **In 30 seconds:** press **Try a photo** on the [home page](https://remedy-y0ym.onrender.com), **Run it** on the first photo (Brightline's sample charger, cord cut), then **Send $34.99 to the sandbox buyer**: a real PayPal sandbox payout, with its batch id. A paid receipt without sending one: [`/r/recorded`](https://remedy-y0ym.onrender.com/r/recorded).
- **Then:** [`/evidence`](https://remedy-y0ym.onrender.com/evidence), [TESTING.md](TESTING.md#buy-claim-and-refund-to-the-original-purchase-about-3-minutes) and [`/firm`](https://remedy-y0ym.onrender.com/firm).
- **Claims to evidence:** [docs/evidence-index.md](docs/evidence-index.md), ten claims with page, file, line and test.

![One photo, six checks in code, two reviewers when unsure, then PayPal pays once](docs/img/flow.svg)

## Run it yourself

Node 24 and Docker; only `DATABASE_URL` is required ([`.env.example`](.env.example); PayPal keys: [docs/run-and-test.md](docs/run-and-test.md#paypal-keys)).

```bash
git clone https://github.com/usv240/remedy && cd remedy
npm ci
cp .env.example .env.local
docker compose up -d                                # Postgres 17
npm run db:migrate && npm run db:load && npm run db:seed
npx tsx --env-file=.env.local scripts/seed-firm.ts  # sample claims and plan
npm run dev                                         # http://localhost:3300
npm test                                            # 630 passed, 61 skipped without a database or keys
```

Without a Claude key, every model answer is a recorded one and a new photo goes to a person at the firm; the checks in code, sandbox payments and the firm console run live.

## Results

Every figure is counted by code ([docs/results.md](docs/results.md)).

- **Two error rates, on photos with a known answer** ([`src/components/evidence/errors.ts`](src/components/evidence/errors.ts)):
  - **paid when it should not have been: 0 of 46** decisions, on 28 photos.
  - **held for a person or a new photo when it could have been paid: 1 of 4**.
  - The 4 decisions are on one photo, the sample charger with its cord cut.
  - Its right-product score of 0.80 to 0.82 is under the 0.85 pass mark, so only the two reviewers verify it.
  - The two reviewers verified 3 of 4; 1 went to a person at the firm.
- **Photos needing a closer look:** **7 of 7** stopped by code alone, before any AI call ([`content/public/verify-runs.json`](content/public/verify-runs.json)). They are the 7 of the error rates' 50 decisions settled in code; the model made the other 43.
- **Reading the remedy:** Claude Opus 5.5 with a self-check got every field right on **113 of 130** real CPSC remedies, keyword rules 73 of 130 (draft labels, [`content/recalls/benchmark/results.json`](content/recalls/benchmark/results.json)).
- **Snap the label:** **2,201 of 2,216** label readings found their recall; **511 of 511** unlisted products matched none ([`label-eval.json`](content/public/label-eval.json)).

**The difference:** a recall claim portal pays "via check within 10-15 business days" ([its own page](https://www.recallrtr.com/SiteResources/3in1grill/locales/en/translation.json)). Remedy's PayPal payout reached the owner **16 to 19 seconds** after approval, in 12 sandbox runs, and PayPal marked a refund to the original PayPal purchase COMPLETED at once; PayPal says a refund takes 3 to 5 business days to reach the buyer ([`measured.json`](content/public/measured.json), [`e2e-transcript.json`](content/public/e2e-transcript.json)). Other pages read November 8, 2026:

| Wait | The page | Whose |
|---|---|---|
| 4 to 6 weeks | "Please allow 4 to 6 weeks." | [Deale International](https://www.thedeale.com/pages/casaclean-safety-recall), July 17, 2025 |
| No time stated | PayPal or a gift card, "fastest using PayPal" | [Merkury Innovations](https://merkuryinnovations.com/pages/fanrecall), June 11, 2026 |

The sample firms are fictional, and Remedy is not affiliated with the CPSC or any firm. On real CPSC recalls, Remedy's PayPal sandbox account stands in for the recalling firm and pays the refund, so no real money moves.

## Where to look

| | On the site | In the repo |
|---|---|---|
| A complete product | [`/claim/27056`](https://remedy-y0ym.onrender.com/claim/27056) on a phone; [`/firm/claims`](https://remedy-y0ym.onrender.com/firm/claims) | 128 of 128 page views pass axe: [`tests/e2e/pages-a11y.mjs`](tests/e2e/pages-a11y.mjs) |
| What is new | [`/evidence#network`](https://remedy-y0ym.onrender.com/evidence#network); [`/evidence#first`](https://remedy-y0ym.onrender.com/evidence#first) | [`content/public/docket-replay.json`](content/public/docket-replay.json); [`tests/docket-replay.test.ts`](tests/docket-replay.test.ts) |

## PayPal, file by file

Orders and Payments run on the APIMatic-generated PayPal Server SDK; the rest is REST. All sandbox.

| PayPal | The call | Where | Test |
|---|---|---|---|
| Orders v2, JavaScript SDK v6 | `POST /v2/checkout/orders`, captured server side, for the shop and replacements | [`src/lib/paypal/sdk-rest.ts`](src/lib/paypal/sdk-rest.ts) | [`tests/paypal-sdk.test.ts`](tests/paypal-sdk.test.ts); `tests/e2e/claim-shop.mjs`, 11 of 11 (needs keys) |
| Partner Referrals (production onboarding) | `POST /v2/customer/partner-referrals`, then `PayPal-Auth-Assertion` per firm. Today a firm connects its own PayPal REST app, checked with PayPal and stored sealed, because PayPal's Partner Referrals onboarding, the production path, answered this sandbox app with 403 NOT_AUTHORIZED on November 7, 2026. | [`src/lib/paypal/firm-account.ts`](src/lib/paypal/firm-account.ts); [`/stack#onboarding`](https://remedy-y0ym.onrender.com/stack#onboarding) | `tests/firm-limits.test.ts` (needs a database) |
| Refund to the original capture | `POST /v2/payments/captures/{id}/refund` with `PayPal-Request-Id`, inside 180 days | [`src/lib/payments/refunds.ts`](src/lib/payments/refunds.ts) | [`tests/payments.test.ts`](tests/payments.test.ts), "refunds to the original capture once" |
| Payouts | `POST /v1/payments/payouts`, one item per claim; bulk pay is one batch | [`src/lib/payments/router.ts`](src/lib/payments/router.ts) | [`tests/payments.test.ts`](tests/payments.test.ts), "paying exactly once"; `tests/e2e/claim.mjs`, 23 of 23 (needs keys) |
| Transaction Search | `GET /v1/reporting/transactions`, 31-day slices, the firm's buyers | [`src/lib/payments/buyers.ts`](src/lib/payments/buyers.ts) | [`tests/payments.test.ts`](tests/payments.test.ts) |
| Disputes | `GET /v1/customer/disputes`, read before any refund (C6) | [`src/lib/payments/refunds.ts`](src/lib/payments/refunds.ts) | [`tests/payments.test.ts`](tests/payments.test.ts) |
| PayPal MCP server | `get_order`, read only, for C6; the Orders API is the fallback | [`src/lib/paypal/mcp.ts`](src/lib/paypal/mcp.ts) | [`tests/paypal-mcp.test.ts`](tests/paypal-mcp.test.ts) |
| Webhooks | Verified with PayPal (signature, or the event looked up by id) on 15 events; `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` becomes a re-notice task | [`src/lib/payments/webhooks.ts`](src/lib/payments/webhooks.ts), [`src/lib/payments/events.ts`](src/lib/payments/events.ts) | [`tests/payments.test.ts`](tests/payments.test.ts); `tests/e2e/firm.mjs` (needs a database) |

Also built on Claude Opus 5.5, Elastic, Channel3, Bryntum Gantt, AG Grid and Render ([`/stack`](https://remedy-y0ym.onrender.com/stack)). History: the first commit is dated November 5, 2026 and the latest November 10, 2026.

## The problem, and the result

**447 of 1,239** US consumer product recalls since January 2024 (36.1%) refund a photo of the product made safe, more each year: 54 in 2024, 151 in 2025 and 242 in 2026 so far ([CPSC Recalls API](https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-01-01), pulled November 5, 2026); of the 525 whose remedy names a photo and a refund, 447 ask for the product made safe and pay a refund for it, 71 ask for a photo of the product as it is, 5 pay store credit and 2 need no photo ([`content/recalls/proof-split.json`](content/recalls/proof-split.json)).

**What is at stake:** those 447 recalls offer **$471.1 million** in refunds at the lowest stated price (442 of 447 state units and a price; 3 pro-rated refunds state no share and 2 records state no price, so those 5 are left out). **$261.2 million** to **$442.8 million** of it stays unclaimed: the lower figure at the CPSC's FY2025 average correction rate across recalls (44.55%), the higher if about 6 in 100 recalled units come back; each extra point of return sends **$4.7 million** back to owners. The unclaimed range is an inference: it applies rates measured across recalls to these recalls' dollars, not a count of unpaid refunds. The two largest recalls, 24309 and 25394, are $184.0 million of the $471.1 million (39.1%), and the median recall offers $68,000 ([`content/recalls/value.json`](content/recalls/value.json); [`/evidence/market`](https://remedy-y0ym.onrender.com/evidence/market#money)).

**From primary sources**, read November 8, 2026 ([docs/research.md](docs/research.md)):

- **44.55%**: the CPSC's FY2025 average correction rate across recalls (target 43%), by a method revised in FY2024 and not comparable with the 6 in 100.
- **91 FR 20138**: the CPSC's April 2026 request for information on recall claims that are not genuine; on its docket, **767** registrations under one name and one device filing over **400** claims.
- Of **10,110** CPSC recall records since 1973, one names PayPal and none names Venmo ([`listing-mentions.ts`](scripts/recalls/listing-mentions.ts)). A PayPal payout costs **$0.25**, a paper check **$2 to $4**. **70%** of Americans had not heard of a recall for anything they own in five years (Consumer Reports).

**Reaching the owner directly moves recalls.** Across 338 CPSC recalls from 2001 to 2013, the share corrected was **11.4%** higher on average with a full remedy than a partial one ([Raithel, Hock and Mafael, 2024](https://link.springer.com/article/10.1007/s11747-023-00967-x)). From a tax credit, not a recall: of 35,050 filers who had not claimed the Earned Income Tax Credit after a first notice, a simpler second notice raised claiming from **14% to 23%**, and showing the amount raised it to **31%** ([Bhargava and Manoli, 2015](https://www.aeaweb.org/articles?id=10.1257/aer.20121493)). That a faster refund raises claims is an inference from the cited studies (a full remedy against a partial one; a simpler tax-credit notice), not a measurement of Remedy.

Measured: **0 of 46 paid wrongly**, the photo check in **about 11 seconds** (about 22 when the two reviewers look), the PayPal payout in **about 19** ([`content/public/facts.json`](content/public/facts.json)).

**Who pays Remedy:** the firm, a fee per finished claim. Proposed: $1.00 per finished claim (a proposal, not a price list), so a refund costs the firm $1.25 with PayPal's $0.25 payout fee, against the $2 to $4 a paper check costs its issuer today ([`src/lib/pricing.ts`](src/lib/pricing.ts)).

## Three ideas at its heart

1. **Each firm that joins makes every other firm safer.** Every claim photo is matched against the 1,779 published pictures of every recall that are distinct enough to tell their recall apart (of 1,825 stored) and every photo already claimed, at any firm.
   - **A replay of the pattern on the CPSC's docket**, one device filing over 400 claims (not the real claims): 400 altered copies of one claimed photo, filed at two sample firms. The pool held **308 of 400** before any model call; the 78 that went on to the model step are all phone screenshots, and none was paid ([`content/public/docket-replay.json`](content/public/docket-replay.json)).
   - Two 64-bit hashes, a difference hash ([`dhash.ts`](src/lib/verify/dhash.ts)) and one of the photo's center ([`phash.ts`](src/lib/verify/phash.ts)). Measured on 117 reused copies of 9 photos: the two hashes together catch 108 of 117 across firms, with 0 unrelated matches; the difference hash alone catches 74 at its 4-bit threshold across firms (85 at 10 bits), with 0 unrelated matches. Only the phone screenshot copies get past both ([`hash-reuse-run.json`](content/public/hash-reuse-run.json)).
   - Matching by hash alone is proven by [Microsoft PhotoDNA](https://www.microsoft.com/en-us/photodna) and [StopNCII](https://stopncii.org/how-it-works/); Remedy's pool is open code, holds recall photos, and shares only two 64-bit hashes and a row id.
   - The hash comparison itself takes a median of 2 ms (0.2 to 93.8 ms); reading the photo and answering takes a median of 98 ms (55 to 200 ms), across 7 recorded runs with no model call.
   - **One photo, two firms:** a photo claimed at Brightline Home, sent for Fernway Home's recall, is held for a person before any model call; only the hash and a row id cross ([`network-run.json`](content/public/network-run.json)).
2. **A payout nobody accepts becomes a task:** when PayPal's webhook reports one waiting (`PAYMENT.PAYOUTS-ITEM.UNCLAIMED`), a re-notice task appears in the firm's plan, live ([`src/lib/payments/events.ts`](src/lib/payments/events.ts)).
3. **The refund goes back the way it was paid:** to the original PayPal capture inside PayPal's 180-day window, else a payout. Plain code picks the route and the amount (`planPayment()` in [`src/lib/payments/router.ts`](src/lib/payments/router.ts)).

**What is first here,** beside the nearest products: [`/evidence#first`](https://remedy-y0ym.onrender.com/evidence#first).

## See it

| Refunded to the PayPal purchase | Two reviewers, when unsure | The recall plan |
|---|---|---|
| ![The refund receipt](docs/img/5-refund-to-purchase.png) | ![The two reviewers in the claim drawer](docs/img/6-two-reviewers.png) | ![The recall plan in Bryntum Gantt](docs/img/8-gantt-re-notice.png) |

## Read more

[docs/how-it-works.md](docs/how-it-works.md) (the six checks), [docs/results.md](docs/results.md), [docs/research.md](docs/research.md), [docs/operations.md](docs/operations.md), [docs/run-and-test.md](docs/run-and-test.md) and [TESTING.md](TESTING.md) (sandbox accounts).

## Sources and credits

- **Recall data and images:** U.S. Consumer Product Safety Commission, public domain.
- **Sample charger:** Dmitry G, Wikimedia Commons, public domain, brand marks removed; not recalled by its maker ([`CREDITS.json`](public/samples/charger/CREDITS.json)). Every test photo: [`credits.json`](content/verify/fixtures/credits.json).
- **Fonts:** Sentient (ITF Free Font License) and IBM Plex Sans (SIL OFL), licenses in `src/app/fonts/`.

## License

[MIT](LICENSE)
