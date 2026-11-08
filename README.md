# Remedy

Recall refunds in seconds, for the owners of recalled products and the firms that recall them. The owner makes the product safe the way the recall asks (cuts the cord, cuts it in half, or writes "RECALLED" on it) and snaps one photo. Remedy checks that photo against the official recall, and PayPal pays the refund: straight back to the original purchase when it was bought with PayPal, or as a payout to an email, a phone or Venmo.

**The difference:** a recall claim portal today pays the refund "via check within 10-15 business days" once the claim is confirmed, as [its own page](https://www.recallrtr.com/SiteResources/3in1grill/locales/en/translation.json) states it. Remedy's PayPal payout reached the owner **17 to 18 seconds** after approval, in 4 PayPal sandbox runs, and a refund to the original PayPal purchase went through at once ([`content/public/measured.json`](content/public/measured.json)).

- **Live:** [remedy-y0ym.onrender.com](https://remedy-y0ym.onrender.com) (PayPal sandbox; no Remedy login needed)
- **Start here:** [`/evidence`](https://remedy-y0ym.onrender.com/evidence) has a five-minute path and every figure with its source file. To watch a photo become a refund, open [`/try`](https://remedy-y0ym.onrender.com/try) and run Brightline's sample charger, or press **Run it live** to watch Claude read it now (one live run a day per visitor, within the site's daily AI budget); to do it end to end with your own sandbox purchase, follow [Buy, claim and refund](TESTING.md#buy-claim-and-refund-to-the-original-purchase-about-3-minutes) in TESTING.md, which also has the sandbox buyer login. The firm's side is at [`/firm`](https://remedy-y0ym.onrender.com/firm).
- **Demo video:** [youtu.be/VIDEO_ID](https://youtu.be/VIDEO_ID)

## Results

Each figure is counted by code from a file in the repo; [docs/results.md](docs/results.md) has every result in full with its source.

- **Two error rates, on photos with a known answer:** **paid when it should not have been: 0 of 36** decisions, on 18 photos; **held for a person or a new photo when it could have been paid: 1 of 4**, on the sample charger with its cord cut (three paid through the two reviewers, one sent to a person at the firm) ([`src/components/judges/errors.ts`](src/components/judges/errors.ts)).
- **Photos that need a closer look:** **7 of 7** stopped by code alone, before any AI call ([`content/public/verify-runs.json`](content/public/verify-runs.json)).
- **Reading the remedy:** Claude Opus 5.5 with a self-check got every field right on **113 of 130** real CPSC remedies, against 73 of 130 for keyword rules (draft labels, [`content/recalls/benchmark/results.json`](content/recalls/benchmark/results.json)).

Every payment runs in the PayPal sandbox. Brightline Home and Fernway Home, the firms in the demo, are fictional sample firms, and their sample recalls BH-2026-01 and FW-2026-01 are fictional too. Real CPSC recalls appear with their real data and credited images; Remedy is not affiliated with the CPSC or any recalling firm.

## The problem, and the result

**447 of 1,239** US consumer product recalls since January 2024 (36.1%) already refund an owner who sends a photo of the product made safe, and the number grows each year: 54 in 2024, 151 in 2025 and 242 in 2026 so far ([CPSC Recalls API](https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-01-01), public domain, pulled November 5, 2026). The count reads each recall's proof rule: of the 525 whose remedy names a photo and a refund, 447 ask for the product made safe and pay a refund for it, 71 ask for a photo of the product as it is (proof of ownership, or a label or code), 5 pay store credit and 2 need no photo ([`content/recalls/proof-split.json`](content/recalls/proof-split.json)). Today each photo goes to a firm's inbox and is read by hand.

**What is at stake:** those 447 recalls offer **$471.1 million** in refunds at the lowest price each CPSC record states, or the fixed refund its rule states when that is lower (442 of 447 state units and a price; 3 pro-rated refunds state no share and are left out). At the average of about 6 in 100 that come back, **$442.8 million** of it stays unclaimed, and each extra point of return sends **$4.7 million** back to owners ([`content/recalls/value.json`](content/recalls/value.json), method on [`/evidence/market`](https://remedy-y0ym.onrender.com/evidence/market#money)).

Reaching the owner directly is what moves recalls: by CPSC staff's recall data, about **50%** of products are corrected when the firm contacts its buyers directly, against **6%** after a press release ([OECD, 2018](https://one.oecd.org/document/DSTI/CP/CPS(2018)1/FINAL/en/pdf)). Across 338 CPSC recalls from 2001 to 2013, the share of recalled products corrected was **11.4%** higher on average when the firm offered a full remedy (a free repair, exchange or refund) instead of a partial one ([Raithel, Hock and Mafael, 2024](https://link.springer.com/article/10.1007/s11747-023-00967-x)). From a tax credit, not a recall: among 35,050 tax filers who had not claimed the Earned Income Tax Credit after a first notice, a simpler second notice raised claiming from **14% to 23%**, and showing the amount more prominently raised it to **31%** ([Bhargava and Manoli, 2015](https://www.aeaweb.org/articles?id=10.1257/aer.20121493)). About **6 in 100** recalled products come back today, by the CPSC's measure. Every finding, with what Remedy does about it: [docs/research.md](docs/research.md).

Remedy makes the claim one photo on a phone, with the refund named in its first line. Measured on photos with a known answer: **0 of 36 paid wrongly**, the photo check in **about 11 seconds**, and the PayPal payout in **about 18** ([`content/public/facts.json`](content/public/facts.json), counted from the recorded runs and the sandbox timings).

## Three ideas at its heart

1. **Each firm that joins makes every other firm safer.** Every claim photo is matched by a 64-bit perceptual hash against the 1,779 distinct published pictures of every recall and against every photo already claimed, at any firm, with no model call. The hash comparison itself takes a median of 2 ms (0.2 to 93.8 ms); reading the photo and answering takes a median of 98 ms (55 to 200 ms), across 7 recorded runs with no model call. Firms share only the hashes, never a photo, a claimant or a recall ([`src/lib/verify/dhash.ts`](src/lib/verify/dhash.ts)). **One photo, two firms:** a photo already claimed at Brightline Home, sent for Fernway Home's recall, is held for a person before any model call because its hash matches Brightline's claim; only the hash and a row id cross ([`content/public/network-run.json`](content/public/network-run.json), recorded by [`scripts/public/record-network-run.ts`](scripts/public/record-network-run.ts), on [`/evidence#network`](https://remedy-y0ym.onrender.com/evidence#network)).
2. **The refund goes back the way it was paid.** Inside PayPal's 180-day window, a verified claim is refunded to its original PayPal capture; after it, the owner gets a PayPal payout to an email or phone, or Venmo. Plain code picks the route and the amount (`planPayment()` in [`src/lib/payments/router.ts`](src/lib/payments/router.ts)).
3. **A payout nobody accepts becomes a task.** When PayPal's webhook reports a payout waiting to be accepted (`PAYMENT.PAYOUTS-ITEM.UNCLAIMED`), a re-notice task appears in the firm's recall plan, in the open Gantt without a reload, linked to its payout batch ([`src/lib/payments/events.ts`](src/lib/payments/events.ts)).

An AI assistant can take an owner through all of it with Remedy's MCP tools: [`/developers`](https://remedy-y0ym.onrender.com/developers) shows a recorded session of real tool calls, from finding the recall to a verified claim ([`content/public/mcp-session.json`](content/public/mcp-session.json)).

## See it

| Recall refunds in seconds: the CPSC's own made-safe photo sits in the headline | On a phone: the recall's remedy as a checklist |
|---|---|
| ![Remedy home page: the headline "Recall refunds in seconds" with the CPSC's photo of a hair dryer cord cut in half set into it](docs/img/1-home.png) | ![The claim page for recall 27056 at phone width: the recall, then the steps to make it safe and one photo to take](docs/img/2-claim-checklist.png) |
| **Six checks, in plain words** | **The firm's claims queue (AG Grid)** |
| ![The six checks completing on a phone: right product, made safe, your own photo, within the recall, claim limits, not already refunded](docs/img/3-checks.png) | ![Brightline Home's claims queue: photo, claimant shown masked, checks, decision, amount and payout status, with bulk Approve and pay](docs/img/7-claims-grid.png) |

## How it works

Claude Opus 5.5 reads each recall's official remedy into a structured proof rule. The owner takes one photo on a phone, with no account. Six checks run: right product, made safe, the owner's own photo, within the recall, claim limits, and not already refunded. Plain code decides: verified when all six pass under the firm's auto-approve cap, a friendly retake when the photo needs a change, two Claude reviewers when a check is unclear, and a person at the firm for anything else. PayPal then refunds the original purchase or sends a payout. Claude reads remedies and photos; the money math, the decision and the payment route are plain code, never the model.

PayPal (Payouts, Refunds, Orders v2 with the JavaScript SDK v6, Transaction Search, Disputes, webhooks, and PayPal's own MCP server, read only, for the not-already-refunded check), Claude, Elastic, Channel3, Bryntum, AG Grid, APIMatic and Render each have one job. [`/stack`](https://remedy-y0ym.onrender.com/stack) lists them with their files, and [`/status`](https://remedy-y0ym.onrender.com/status) shows whether each is live.

## Read more

- [docs/how-it-works.md](docs/how-it-works.md): the six checks, what the AI never decides, what is inside, and how the AI cost is kept low.
- [docs/results.md](docs/results.md): every result and measurement, with its source file.
- [docs/research.md](docs/research.md): the published findings Remedy is built on, and a 30-day pilot.
- [docs/operations.md](docs/operations.md): running it for real, observability, security and privacy.
- [docs/run-and-test.md](docs/run-and-test.md): run it yourself, and every test suite.
- [TESTING.md](TESTING.md): the sandbox accounts and step-by-step checks.

## Sources and credits

- **Recall data and images:** U.S. Consumer Product Safety Commission, public domain (US government works), credited wherever they appear. The made-safe example photos are the CPSC's own, from recalls 26125 (a hair dryer with its cord cut) and 25007 (a helmet with its straps cut).
- **Sample charger photos:** one real laptop charger by Dmitry G on Wikimedia Commons, public domain, brand marks removed ([`public/samples/charger/CREDITS.json`](public/samples/charger/CREDITS.json)). Its maker has not recalled it.
- **Test photo:** "Coffee in a mug" by Kurt Kaiser, via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Coffee_in_a_mug.jpg), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Every fixture is listed in [`content/verify/fixtures/credits.json`](content/verify/fixtures/credits.json).
- **Research:** every source is in [docs/research.md](docs/research.md); the counting method is on [`/learn#data`](https://remedy-y0ym.onrender.com/learn#data).
- **Fonts:** Sentient by Indian Type Foundry (ITF Free Font License) and IBM Plex Sans by IBM (SIL Open Font License), self-hosted with their licenses in `src/app/fonts/`.
- Brightline Home, Fernway Home and their sample products are fictional.

## License

[MIT](LICENSE)
