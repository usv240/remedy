# Grounded in research

Part of the [Remedy README](../README.md). The published findings Remedy is built on, and the pilot that would measure it with a real firm.

## The measured contrast

A recall claim portal today states its refund timing on its own page: "Once your registration is confirmed, your refund will be issued via check within 10-15 business days" ([Real Time Results, Cuisinart grill recall portal](https://www.recallrtr.com/SiteResources/3in1grill/locales/en/translation.json), read November 8, 2026). Remedy's PayPal payout reached the owner 17 to 18 seconds after approval, in 4 PayPal sandbox runs, and a refund to the original PayPal purchase went through at once ([`content/public/measured.json`](../content/public/measured.json)). The research below is why that speed, and a claim that asks for one photo, can move more recalled products out of homes.

## The findings

Published findings Remedy is built on, each read from the source itself. The same list is on [`/evidence#research`](https://remedy-y0ym.onrender.com/evidence#research).

| Finding | In Remedy | Source |
|---|---|---|
| By CPSC staff's recall data, about **50%** of products are corrected by consumers when the firm contacts its buyers directly, against **6%** after a press release; the CPSC's workshop report finds direct notice recalls the most effective | A firm finds the buyers who paid it with PayPal through Transaction Search, or in its own sales file, and Remedy makes each a personal claim link and a notice that the firm downloads and sends from its own mail tool | [OECD, Enhancing Product Recall Effectiveness Globally](https://one.oecd.org/document/DSTI/CP/CPS(2018)1/FINAL/en/pdf), 2018, p. 19; [CPSC Recall Effectiveness Workshop Report](https://www.cpsc.gov/s3fs-public/Recall_Effectiveness_Workshop_Report-2018.pdf), 2018, p. 5 |
| In a behavioural experiment, **72%** of people shown a direct recall notice decided to act, against **31%** shown a generic one; of those who did nothing, **21%** said the process was too much effort or time | One page on a phone, no account, one photo, the refund named in its first line | [LE Europe, VVA, Ipsos and ConPolicy for the European Commission](https://mpo.gov.cz/assets/cz/ochrana-spotrebitele/bezpecnost-vyrobku/2021/10/Behavioural-study---final-report.pdf), 2021, pp. 18 and 31 |
| Vehicle recalls, where the maker mails each registered owner, fix about **70%** of vehicles within 18 months, by NHTSA's figures | PayPal's record of the purchase stands in for an owner registry: the buyer is found, and the refund goes back to that payment inside 180 days | [GAO-11-603, Auto Safety](https://www.gao.gov/assets/gao-11-603.pdf), 2011, p. 1 |
| Across 338 CPSC recalls from 2001 to 2013, the share of recalled products corrected was **11.4%** higher on average when the firm offered a full remedy (a free repair, exchange or refund) instead of a partial one, all else equal; experiments in the same study find owners see more benefit and feel more able to take part | Each claim names the refund in its first line (481 of the 583 proof rules state it plainly), and the remedy becomes up to four plain steps with a drawing for each | Raithel, Hock and Mafael, [Journal of the Academy of Marketing Science](https://link.springer.com/article/10.1007/s11747-023-00967-x), 2024 |
| From a tax credit, not a recall: in an IRS field experiment with 35,050 tax filers who had not claimed the Earned Income Tax Credit after a first notice, a simpler second notice raised claiming from **14% to 23%**, and showing the amount more prominently raised it to **31%** | One page on a phone, no account, one photo, and the refund named up front | Bhargava and Manoli, [American Economic Review](https://www.aeaweb.org/articles?id=10.1257/aer.20121493), 2015 |
| On average, about **6 in 100** recalled products come back through a recall, by the CPSC's measure | A finished claim takes one photo: the check runs in about 11 seconds (the median of the recorded live checks) and the PayPal payout in about 18, measured in the sandbox | CPSC Recall Effectiveness Workshop, 2017, as cited by Raithel, Hock and Mafael, 2024 |
| The CPSC's January 2025 order has Amazon email each buyer directly and refund the full price on proof of destruction or disposal, for **400,000+** products | The same pattern for any firm: buyers who paid with PayPal are found through Transaction Search, and each proof photo is checked and refunded | [CPSC](https://www.cpsc.gov/Newsroom/News-Releases/2025/CPSC-Issues-Final-Order-to-Amazon-com-Outlining-Remediation-Plans-for-Hazardous-Products), January 17, 2025 |
| The difference hash treats pictures more than **10 bits** apart as different images, and 1 to 10 bits as variations, after tests on over 150,000 images | Matched within 10 bits to the recall's own pictures, and within 4 bits to the 1,779 distinct pictures of every other recall | Neal Krawetz, [Kind of Like That](https://www.hackerfactor.com/blog/index.php?/archives/529-Kind-of-Like-That.html), 2013 |
| **440 million** active PayPal accounts at the end of September 2026 | Refunds go back to the original PayPal purchase inside 180 days, or out as a payout to an email or phone number, with no bank details asked | PayPal Holdings, [third-quarter 2026 results](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000086/pypl3q-26earningsrelease.htm), October 27, 2026 |

## A 30-day pilot

One small firm with an open photo-refund recall runs every claim on that recall through Remedy for 30 days, from its own claim link, beside its current inbox. Two outcomes, each against the month before:

| Outcome | Baseline | Already recorded in |
|---|---|---|
| Time from photo to refund | The firm's median days from an emailed photo to its refund, from its own records for the 30 days before | Each claim's `claim.submitted` and `claim.paid` entries in the audit ledger and the payment's `paid_at`, shown in the firm's claims queue |
| Share of claims a person had to open | Every emailed photo, read by hand today | Each claim's decision in the `claim` table and the ledger's `claim.decided` entries, and the queue's Needs review view |

**Why it holds up:** an established tool that adds the same model gains a reader of photos; what makes each payout safe to send is the checks in code, the hash-chained evidence behind every payment, and the error rates measured on photos with known answers. It also grows with use: every claim photo is checked against the published pictures of every recall and every photo already claimed on any recall, at any firm, by a 64-bit hash alone, so each firm that joins makes every other firm's refunds safer.
