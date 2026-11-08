# Remedy

Recall refunds in seconds, for the owners of recalled products and the firms that recall them. The owner makes the product safe the way the recall asks (cuts the cord, cuts it in half, or writes "RECALLED" on it) and snaps one photo. Remedy checks that photo against the official recall, and PayPal pays the refund: straight back to the original purchase when it was bought with PayPal, or as a payout to an email, a phone or Venmo.

**What is at stake:** the 525 US recalls since 2024 that refund an owner for a photo cover **$1.4 billion** of products at the lowest price each CPSC record states (522 of 525 state units and a price). At the average of about 6 in 100 that come back, **$1.3 billion** of those products stays in homes unclaimed, and each extra point of return is worth **$14.7 million** to their owners in refunds or replacements ([`content/recalls/value.json`](content/recalls/value.json), method on [`/evidence/market`](https://remedy-y0ym.onrender.com/evidence/market#money)).

- **Live:** [remedy-y0ym.onrender.com](https://remedy-y0ym.onrender.com) (PayPal sandbox; no Remedy login needed)
- **Start here:** [`/evidence`](https://remedy-y0ym.onrender.com/evidence) has a five-minute path and every figure with its source file. To watch a photo become a refund, open [`/try`](https://remedy-y0ym.onrender.com/try) and run Brightline's sample charger, or press **Run it live** to watch Claude read it now (one live run a day per visitor, within the site's daily AI budget); to do it end to end with your own sandbox purchase, follow [Buy, claim and refund](TESTING.md#buy-claim-and-refund-to-the-original-purchase-about-3-minutes) in TESTING.md, which also has the sandbox buyer login.
- **Demo video:** [youtu.be/VIDEO_ID](https://youtu.be/VIDEO_ID)

Every payment runs in the PayPal sandbox. Brightline Home and Fernway Home, the firms in the demo, are fictional sample firms, and their sample recalls BH-2026-01 and FW-2026-01 are fictional too. Real CPSC recalls appear with their real data and credited images; Remedy is not affiliated with the CPSC or any recalling firm.

## The problem, and the result

**525 of 1,239** US consumer product recalls since January 2024 (42%) already offer a refund once the owner sends a photo showing the product made safe, and the share grows each year: 71 photo-refund recalls in 2024, 172 in 2025 and 282 in 2026 so far ([CPSC Recalls API](https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-01-01), public domain, pulled November 5, 2026; counts and definitions in [`content/recalls/stats.json`](content/recalls/stats.json)). Today each photo goes to a firm's inbox and is read by hand.

Reaching the owner directly is what moves recalls: by CPSC staff's recall data, about **50%** of products are corrected when the firm contacts its buyers directly, against **6%** after a press release ([OECD, 2018](https://one.oecd.org/document/DSTI/CP/CPS(2018)1/FINAL/en/pdf)), and across 338 CPSC recalls a full refund lifts the share that come back by **11.4%** ([Raithel, Hock and Mafael, 2024](https://link.springer.com/article/10.1007/s11747-023-00967-x)). From another kind of claim, a simpler notice raised claiming from **14% to 23%**, and naming the amount in the headline raised it to **31%** ([Bhargava and Manoli, 2015](https://www.aeaweb.org/articles?id=10.1257/aer.20121493)). About **6 in 100** recalled products come back today, by the CPSC's measure. Every finding, with what Remedy does about it: [docs/research.md](docs/research.md).

Remedy makes the claim one photo on a phone, with the refund named in its first line. Measured on photos with a known answer: **0 of 36 paid wrongly**, the photo check in **about 11 seconds**, and the PayPal payout in **about 18** ([`content/public/facts.json`](content/public/facts.json), counted from the recorded runs and the sandbox timings).

## Three ideas at its heart

1. **Each firm that joins makes every other firm safer.** Every claim photo is matched by a 64-bit perceptual hash against the 1,779 distinct published pictures of every recall and against every photo already claimed, at any firm, with no model call. The hash comparison itself takes a median of 2 ms (0.2 to 93.8 ms); reading the photo and answering takes a median of 98 ms (55 to 200 ms), across 7 recorded runs with no model call. Firms share only the hashes, never a photo, a claimant or a recall ([`src/lib/verify/dhash.ts`](src/lib/verify/dhash.ts)). **One photo, two firms:** a photo already claimed at Brightline Home, sent for Fernway Home's recall, is held for a person before any model call because its hash matches Brightline's claim; only the hash and a row id cross ([`content/public/network-run.json`](content/public/network-run.json), recorded by [`scripts/public/record-network-run.ts`](scripts/public/record-network-run.ts), on [`/evidence#network`](https://remedy-y0ym.onrender.com/evidence#network)).
2. **The refund goes back the way it was paid.** Inside PayPal's 180-day window, a verified claim is refunded to its original PayPal capture; after it, the owner gets a PayPal payout to an email or phone, or Venmo. Plain code picks the route and the amount (`planPayment()` in [`src/lib/payments/router.ts`](src/lib/payments/router.ts)).
3. **A payout nobody accepts becomes a task.** When PayPal's webhook reports a payout waiting to be accepted (`PAYMENT.PAYOUTS-ITEM.UNCLAIMED`), a re-notice task appears in the firm's recall plan, in the open Gantt without a reload, linked to its payout batch ([`src/lib/payments/events.ts`](src/lib/payments/events.ts)).

An AI assistant can take an owner through all of it with Remedy's MCP tools: [`/developers`](https://remedy-y0ym.onrender.com/developers) shows a recorded session of real tool calls, from finding the recall to a verified claim ([`content/public/mcp-session.json`](content/public/mcp-session.json)).

## Results

Each figure is counted by code from a file in the repo; [docs/results.md](docs/results.md) has each one in full with its source.

- **Two error rates, on photos with a known answer:** **paid when it should not have been: 0 of 36** decisions, on 18 photos; **held for a person or a new photo when it could have been paid: 1 of 4**, on the sample charger with its cord cut (three paid through the two reviewers, one sent to a person at the firm) ([`src/components/judges/errors.ts`](src/components/judges/errors.ts)).
- **Photos that need a closer look:** **7 of 7** stopped by code alone, before any AI call ([`content/public/verify-runs.json`](content/public/verify-runs.json)).
- **Reading accuracy on real CPSC recalls: 16 of 18 readings right**, on the CPSC's own photos of products made safe (right product 9 of 9, made safe 7 of 9).
- **Reading the remedy:** Claude Opus 5.5 with a self-check got every field right on **113 of 130** real CPSC remedies, against 73 of 130 for keyword rules (draft labels, [`content/recalls/benchmark/results.json`](content/recalls/benchmark/results.json)).
- **Model settings, scored as they stood:** the claim path's setting was right on **18 of 24** against the known answers on the day the sweep ran, and **22 of 24** re-scored after two answers were revised, each dated with its case id and reason in [`content/verify/answer-changes.json`](content/verify/answer-changes.json) and on [`/evidence/photo-checks`](https://remedy-y0ym.onrender.com/evidence/photo-checks#answer-changes).
- **The sample recall's reference pictures** now show what a firm publishes (the whole charger, where the cord meets the case, and the DC plug): the sample charger's right-product score went from 0.75 to 0.80 to 0.82, still under the 0.85 pass mark ([`content/verify/sample-references.json`](content/verify/sample-references.json)).

## See it

| Recall refunds in seconds: the CPSC's own made-safe photo sits in the headline | On a phone: the recall's remedy as a checklist |
|---|---|
| ![Remedy home page: the headline "Recall refunds in seconds" with the CPSC's photo of a hair dryer cord cut in half set into it](docs/img/1-home.png) | ![The claim page for recall 27056 at phone width: the recall, then the steps to make it safe and one photo to take](docs/img/2-claim-checklist.png) |
| **Six checks, in plain words** | **The firm's claims queue (AG Grid)** |
| ![The six checks completing on a phone: right product, made safe, your own photo, within the recall, claim limits, not already refunded](docs/img/3-checks.png) | ![Brightline Home's claims queue: photo, claimant shown masked, checks, decision, amount and payout status, with bulk Approve and pay](docs/img/7-claims-grid.png) |

## How it works

Claude Opus 5.5 reads each recall's official remedy into a structured proof rule. The owner takes one photo on a phone, with no account. Six checks run: right product, made safe, the owner's own photo, within the recall, claim limits, and not already refunded. Plain code decides: verified when all six pass under the firm's auto-approve cap, a friendly retake when the photo needs a change, two Claude reviewers when a check is unclear, and a person at the firm for anything else. PayPal then refunds the original purchase or sends a payout. Claude reads remedies and photos; the money math, the decision and the payment route are plain code, never the model.

PayPal (Payouts, Refunds, Orders v2 with the JavaScript SDK v6, Transaction Search, Disputes and webhooks), Claude, Elastic, Channel3, Bryntum, AG Grid, APIMatic and Render each have one job. [`/stack`](https://remedy-y0ym.onrender.com/stack) lists them with their files, and [`/status`](https://remedy-y0ym.onrender.com/status) shows whether each is live.

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
