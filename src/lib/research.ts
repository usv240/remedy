import listing from "../../content/recalls/listing-mentions.json";

/**
 * The published findings Remedy is built on, each figure read from the source itself (2026-11-07): the paper, the
 * experiment, the order, the post or the filing linked here. The one place these figures live: /evidence#research,
 * the home page and the README all read them from here (tests/facts.test.ts checks the README). Pure, apart from the
 * committed count of the CPSC listing it imports.
 */
export const RESEARCH = {
  /**
   * Recall-specific, first. CPSC staff's recall data (Recall Effectiveness Workshop, July 2017), as the OECD reports
   * it (p. 19): "when consumers are contacted through recalls alerts, the consumer correction rate is at 50%, against
   * 6% in the case of a press release". A Recall Alert is a recall where the firm can reach its buyers directly.
   */
  directNotice: {
    direct: "50%",
    press: "6%",
    source: "CPSC recall data (2017 workshop), as reported by the OECD, Enhancing Product Recall Effectiveness Globally, 2018",
    short: "OECD, 2018",
    url: "https://one.oecd.org/document/DSTI/CP/CPS(2018)1/FINAL/en/pdf",
  },
  /** The CPSC's own workshop report (p. 5): "Direct notice recalls have proven to be the most effective recalls." */
  cpscReport: {
    source: "CPSC Office of Compliance, Recall Effectiveness Workshop Report, February 2018",
    url: "https://www.cpsc.gov/s3fs-public/Recall_Effectiveness_Workshop_Report-2018.pdf",
  },
  /**
   * A behavioural experiment for the European Commission (p. 31): 72% of people shown a direct recall notice decided
   * to act on it, against 31% shown a generic one; of those who took no action, 21% named "too much effort/time" (p. 18).
   */
  euStudy: {
    direct: "72%",
    generic: "31%",
    effort: "21%",
    source: "LE Europe, VVA, Ipsos and ConPolicy for the European Commission, Behavioural Study on Strategies to Improve the Effectiveness of Product Recalls, 2021",
    short: "European Commission study, 2021",
    url: "https://mpo.gov.cz/assets/cz/ochrana-spotrebitele/bezpecnost-vyrobku/2021/10/Behavioural-study---final-report.pdf",
  },
  /**
   * Vehicle recalls, where the maker mails each registered owner (GAO-11-603, p. 1): "on average only about 70 percent
   * of vehicles subject to a recall are fixed within the 18-month period".
   */
  vehicles: {
    fixed: "70%",
    source: "U.S. Government Accountability Office, GAO-11-603, Auto Safety, June 2011",
    short: "GAO, 2011",
    url: "https://www.gao.gov/assets/gao-11-603.pdf",
  },
  /**
   * How a claim portal states its refund timing today, word for word from its own published page text (key
   * step1.registration_instructions.step3a, read 2026-11-08): "Once your registration is confirmed, your refund will be
   * issued via check within 10-15 business days." The comparison table on /evidence/market cites the same page.
   */
  portal: {
    days: "10 to 15 business days",
    how: "by check, after the claim is confirmed",
    quote: "Once your registration is confirmed, your refund will be issued via check within 10-15 business days.",
    source: "Real Time Results, Cuisinart grill recall portal (recallrtr.com), its published page text",
    short: "a recall portal's own page",
    url: "https://www.recallrtr.com/SiteResources/3in1grill/locales/en/translation.json",
  },
  /**
   * What it measures (introduction, read 2026-11-08): "recall effectiveness improves, on average, by 11.4% if firms
   * offer full instead of partial remedy (all else equal)". Recall effectiveness is the share of affected products
   * corrected, from CPSC progress reports; a full remedy is a free repair, exchange or refund, a partial one shifts work
   * to the owner (for example a repair kit). 338 CPSC recalls from 2001 to 2013, effectiveness data for 217.
   */
  fullRemedy: {
    lift: "11.4%",
    recalls: 338,
    years: "2001 to 2013",
    what: "the share of recalled products corrected was 11.4% higher on average when the firm offered a full remedy (a free repair, exchange or refund) instead of a partial one, all else equal",
    source: "Raithel, Hock and Mafael, Journal of the Academy of Marketing Science, 2024",
    short: "Raithel, Hock and Mafael, 2024",
    url: "https://link.springer.com/article/10.1007/s11747-023-00967-x",
  },
  /**
   * A tax credit, not a recall: an IRS field experiment with 35,050 tax filers who had not claimed the Earned Income Tax
   * Credit after a first notice. A simpler second notice raised claiming from 14% to 23%, and showing the amount they
   * could get raised it to 31%.
   */
  simpler: {
    from: "14%",
    to: "23%",
    named: "31%",
    filers: "35,050",
    benefit: "the Earned Income Tax Credit",
    source: "Bhargava and Manoli, American Economic Review, 2015",
    short: "Bhargava and Manoli, 2015",
    url: "https://www.aeaweb.org/articles?id=10.1257/aer.20121493",
  },
  comeBack: {
    share: "6 in 100",
    source: "CPSC Recall Effectiveness Workshop, 2017, as cited by Raithel, Hock and Mafael, 2024",
    url: "https://link.springer.com/article/10.1007/s11747-023-00967-x",
  },
  amazonOrder: {
    products: "400,000+",
    source: "U.S. Consumer Product Safety Commission, January 17, 2025",
    url: "https://www.cpsc.gov/Newsroom/News-Releases/2025/CPSC-Issues-Final-Order-to-Amazon-com-Outlining-Remediation-Plans-for-Hazardous-Products",
  },
  dhash: {
    bits: 10,
    images: "150,000",
    source: "Neal Krawetz, The Hacker Factor Blog, 2013",
    url: "https://www.hackerfactor.com/blog/index.php?/archives/529-Kind-of-Like-That.html",
  },
  paypal: {
    accounts: "440 million",
    source: "PayPal Holdings, third-quarter 2026 results, October 27, 2026",
    url: "https://www.sec.gov/Archives/edgar/data/1633917/000163391726000086/pypl3q-26earningsrelease.htm",
  },
} as const;

/** "2026-11-08" as "November 8, 2026". */
const plainDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The CPSC's full recall listing, counted by scripts/recalls/listing-mentions.ts (the CSV itself is not committed). */
const LISTING = listing as { source: string; readAt: string; latestRecallDate: string | null; records: number; terms: Record<string, { count: number; recallNumbers: string[] }> };

/**
 * The problem, measured from primary sources (each read 2026-11-08): the regulator's own correction rate, its request
 * for information on recall claims that are not genuine and two comments on that docket, how firms pay photo-proof refunds today, the payment
 * economics from the issuers, and why owners do not act. Rendered by src/components/evidence/Research.tsx (on
 * /evidence/market), cited in the README and docs/research.md; tests/facts.test.ts checks the README figures.
 */
export const PROBLEM = {
  /**
   * CPSC Agency Performance Report FY2025 (measure 2025KM2.3.1): 44.55% against a 43% target. Footnote 2: at the
   * FY2024 midyear review the method became "an average correction rate for all consumer product recalls", so this is
   * an average across recalls, not the share of recalled units that come back (the "6 in 100" above measures that).
   */
  correctionRate: {
    rate: "44.55%",
    target: "43%",
    year: "FY2025",
    source: "CPSC, Agency Performance Report, Fiscal Year 2025",
    short: "CPSC performance report, FY2025",
    date: "April 2026",
    url: "https://www.cpsc.gov/s3fs-public/FY25-APR.pdf",
  },
  /**
   * Federal Register, Vol. 91, No. 72, pp. 20138-20139: Request for Information Regarding Consumer Product Recall
   * Fraud, docket CPSC-2026-0067. The notice names organized or coordinated networks that exploit online submission
   * processes, "artificially generated images" purporting to show product destruction, and the risk that added
   * verification "may also impose burdens on legitimate consumers and reduce recall participation".
   */
  fraudRfi: {
    cite: "91 FR 20138",
    docket: "CPSC-2026-0067",
    source: "Federal Register, Request for Information Regarding Consumer Product Recall Fraud, docket CPSC-2026-0067",
    short: "CPSC request for information on recall claims, April 2026",
    date: "April 15, 2026",
    url: "https://www.govinfo.gov/content/pkg/FR-2026-04-15/pdf/2026-07328.pdf",
  },
  /**
   * A recall administrator's public comment on that docket (CPSC-2026-0067-0013, pp. 1-3): one group registered over
   * 2,200 recalled products at a refund average of about $100 each; one person submitted 767 registrations under one
   * name and address; it takes seconds to make many unique photos of destroyed units; the administrator now often
   * requires live photo capture, especially where the remedy is a refund.
   */
  adminComment: {
    products: "2,200",
    perUnit: "$100",
    oneName: "767",
    source: "Realtime Results LLC (Recall Results), public comment CPSC-2026-0067-0013",
    short: "a recall administrator's comment, June 2026",
    date: "June 8, 2026",
    url: "https://downloads.regulations.gov/CPSC-2026-0067-0013/attachment_1.pdf",
  },
  /**
   * Truepic's public comment on the same docket (CPSC-2026-0067-0010, p. 4): a single device submitted over 400
   * recall claims, cycling names, emails, phones and addresses; images were captured from identical vantage points
   * across hundreds of claims; each claim, reviewed in isolation, appeared legitimate.
   */
  truepicComment: {
    claims: "400",
    source: "Truepic Inc., public comment CPSC-2026-0067-0010",
    short: "Truepic's comment, May 2026",
    date: "May 29, 2026",
    url: "https://downloads.regulations.gov/CPSC-2026-0067-0010/attachment_1.pdf",
  },
  /**
   * A firm's own recall page that already pays by PayPal (CPSC recall 26-539, June 11, 2026): two photos (the fan with
   * initials, date and RECALLED; the cut cord), no receipt, "Refund Method: PayPal or Gift Card", "You will receive
   * your refund fastest using PayPal", an email confirmation within 48 to 72 hours, and no refund delivery time stated.
   */
  paypalPortal: {
    photos: "two",
    confirm: "48 to 72 hours",
    fastest: "You will receive your refund fastest using PayPal",
    source: "Merkury Innovations, Hot + Cool fan recall page",
    short: "a firm's June 2026 recall page",
    date: "recall dated June 11, 2026; page read November 8, 2026",
    url: "https://merkuryinnovations.com/pages/fanrecall",
  },
  /** A 2025 photo-refund page (steam cleaner, $39.99, cut cord and label photographed): "Please allow 4 to 6 weeks". */
  weeksPortal: {
    wait: "4 to 6 weeks",
    quote: "Please allow 4 to 6 weeks",
    source: "Deale International, CasaClean steam cleaner recall page",
    short: "a 2025 photo-refund page",
    date: "July 17, 2025",
    url: "https://www.thedeale.com/pages/casaclean-safety-recall",
  },
  /** The CPSC's full recall listing since 1973, counted by scripts/recalls/listing-mentions.ts. */
  listing: {
    records: LISTING.records,
    paypal: LISTING.terms.paypal.count,
    venmo: LISTING.terms.venmo.count,
    electronic: LISTING.terms.electronicPayment.count,
    paypalRecall: LISTING.terms.paypal.recallNumbers[0] ?? null,
    source: "CPSC recall listing CSV (every recall since 1973), counted by scripts/recalls/listing-mentions.ts",
    short: "the CPSC's recall listing",
    date: `read ${plainDate(LISTING.readAt)}, latest recall ${LISTING.latestRecallDate ? plainDate(LISTING.latestRecallDate) : "n/a"}`,
    url: LISTING.source,
  },
  /** PayPal's US merchant fees: a flat $0.25 per payout through the Payouts API; no fee to make a refund. */
  payoutFee: {
    fee: "$0.25",
    source: "PayPal, Merchant fees (US)",
    short: "PayPal merchant fees",
    date: "last updated November 4, 2026",
    url: "https://www.paypal.com/us/business/paypal-business-fees",
  },
  /** Payouts FAQ: recipients pay no fee; an unclaimed payment expires in 30 days and the money returns to the sender. */
  payoutTerms: {
    unclaimedDays: 30,
    source: "PayPal Developer, Payouts frequently asked questions",
    short: "PayPal Payouts FAQ",
    date: "last updated October 14, 2026",
    url: "https://developer.paypal.com/docs/payouts/standard/reference/faq",
  },
  /** Refund a payment: within 180 days of the capture; in production, buyers see the refund in 3 to 5 business days. */
  refundTerms: {
    days: 180,
    reach: "3 to 5 business days",
    source: "PayPal Developer, Refund a payment",
    short: "PayPal refund documentation",
    date: "last updated June 4, 2026",
    url: "https://developer.paypal.com/checkout/refund-payment",
  },
  /** AFP 2022 Payments Cost Benchmarking Survey (347 treasury professionals, Sept 2021): issuing a paper check costs $2 to $4. */
  checkCost: {
    cost: "$2 to $4",
    source: "Association for Financial Professionals, 2022 Payments Cost Benchmarking Survey (press release)",
    short: "AFP, 2022",
    date: "January 25, 2022",
    url: "https://www.financialprofessionals.org/about/learn-more/press-releases/Details/survey-73-of-organizations-are-transitioning-their-business-to-business-payments-from-checks-to-digital-payments",
  },
  /**
   * FTC, Consumers and Class Actions (149 settlements, pp. 22-26): median claims rate 9%; in claims-requiring consumer
   * settlements the median check-cashing rate was 94% and the weighted average 77%.
   */
  ftcChecks: {
    settlements: 149,
    claimsRate: "9%",
    cashedWeighted: "77%",
    cashedMedian: "94%",
    source: "Federal Trade Commission, Consumers and Class Actions: A Retrospective and Analysis of Settlement Campaigns",
    short: "FTC, 2019",
    date: "September 2019",
    url: "https://www.ftc.gov/system/files/documents/reports/consumers-class-actions-retrospective-analysis-settlement-campaigns/class_action_fairness_report_0.pdf",
  },
  /** Digital Disbursements 2024 (nearly 600 cases, p. 13): digital payment success 98%; checks cashed 77% with a claims process, 55% without. */
  digitalSuccess: {
    digital: "98%",
    checksWithClaims: "77%",
    checksWithout: "55%",
    source: "Digital Disbursements (Western Alliance Bank), 2024 Annual Report: Digital Payments in Class Actions and Mass Torts",
    short: "Digital Disbursements, 2024",
    date: "April 2024",
    url: "https://www.westernalliancebancorporation.com/sites/default/files/2024-04/2024-digital-payments-research-report.pdf",
  },
  /** Consumer Reports survey of 1,010 US adults: almost 70% had not heard of a recall for any product they own in five years; 21% heard and responded. */
  consumerReports: {
    notHeard: "70%",
    responded: "21%",
    adults: "1,010",
    source: "Consumer Reports, When Recalls Fail (nationally representative survey of 1,010 adults)",
    short: "Consumer Reports, 2019",
    date: "October 31, 2019",
    url: "https://www.consumerreports.org/recalls/when-recalls-fail/",
  },
  /**
   * Ipsos for the European Commission (24,039 respondents, 2,265 of them owners who saw a recall for their product,
   * pp. 20-21 and 26): 35.1% of those owners did not react; of those who contacted the firm, 34.3% were offered a
   * reimbursement, 68.9% a repair, 24.7% nothing.
   */
  euSurvey: {
    noReaction: "35.1%",
    reimbursed: "34.3%",
    respondents: "24,039",
    source: "Ipsos for the European Commission, Survey on consumers' behaviour and perception of product recalls",
    short: "Ipsos for the European Commission, 2019",
    date: "April 2019",
    url: "https://mpo.gov.cz/assets/cz/ochrana-spotrebitele/bezpecnost-vyrobku/2019/4/Product-Recall_study_1.pdf",
  },
  /**
   * The CPSC's 2003 literature review (pp. 24 and 26), reporting a 1980 vehicle recall survey: 23% of non-responders
   * gave reasons of motivation or effort (no time, inconvenience, not important); about 30% asked for an easier, less
   * burdensome process. In-home repair raised the average effectiveness rate 14 points over a return to the maker.
   */
  cpscReview: {
    effort: "23%",
    easier: "30%",
    source: "XL Associates for the CPSC, Recall Effectiveness Research: A Review and Summary of the Literature on Consumer Motivation and Behavior",
    short: "CPSC literature review, 2003",
    date: "July 2003",
    url: "https://www.cpsc.gov/s3fs-public/RecallEffectiveness.pdf",
  },
} as const;

/**
 * How long a photo-refund claim takes to pay today, as each page already read here states it (each read November 8,
 * 2026): a recall administrator's claim portal, a firm's own 2025 page, and a firm's 2026 page that pays by PayPal and
 * states no time. Shown beside Remedy's measured payout, labelled as the sandbox (Contrast in
 * src/components/evidence/Contrast.tsx). Only pages read and cited above; tests/facts.test.ts holds the table to them.
 */
export const PORTAL_WAITS = [
  { id: "rtr", wait: RESEARCH.portal.days, says: `“${RESEARCH.portal.quote}”`, who: "Real Time Results, a recall administrator's claim portal (Cuisinart grill recall)", date: "read November 8, 2026", url: RESEARCH.portal.url },
  { id: "deale", wait: PROBLEM.weeksPortal.wait, says: `“${PROBLEM.weeksPortal.quote}.”`, who: "Deale International's own recall page (CasaClean steam cleaner)", date: `dated ${PROBLEM.weeksPortal.date}, read November 8, 2026`, url: PROBLEM.weeksPortal.url },
  {
    id: "merkury",
    wait: "No time stated",
    says: `PayPal or a gift card: “${PROBLEM.paypalPortal.fastest}”, with an email confirmation in ${PROBLEM.paypalPortal.confirm}.`,
    who: "Merkury Innovations' own recall page (Hot + Cool fan)",
    date: PROBLEM.paypalPortal.date,
    url: PROBLEM.paypalPortal.url,
  },
] as const;

/**
 * Two inferences, said plainly wherever their figures appear (the README and /evidence/market): neither is a
 * measurement of Remedy. tests/facts.test.ts checks both places print them.
 */
export const INFERENCES = {
  claims: "That a faster refund raises claims is an inference from the cited studies (a full remedy against a partial one; a simpler tax-credit notice), not a measurement of Remedy.",
  unclaimed: "The unclaimed range is an inference: it applies rates measured across recalls to these recalls' dollars, not a count of unpaid refunds.",
} as const;

/**
 * Where a shared hash list comes from: two long-running services that match a picture by its hash instead of the
 * picture itself, each read on its own page on November 9, 2026, and how Remedy's pool differs. Shared by the README,
 * /evidence#network and docs/research.md (tests/hash-pool-lineage.test.ts).
 */
export const HASH_LINEAGE = {
  photoDna: {
    name: "Microsoft PhotoDNA",
    says: "makes a hash of an image that cannot be turned back into the image and compares it with the hashes of known images; Microsoft offers it free to qualified organizations and donated it to the National Center for Missing & Exploited Children",
    url: "https://www.microsoft.com/en-us/photodna",
    read: "November 9, 2026",
  },
  stopNcii: {
    name: "StopNCII",
    says: "makes the hash on the person's own device, sends only the hash, never the image, and its partner platforms look for matches",
    url: "https://stopncii.org/how-it-works/",
    read: "November 9, 2026",
  },
  differs: "Remedy's pool is open code, holds recall photos, and shares only two 64-bit hashes and a row id between firms",
} as const;

/**
 * How a refund to the original PayPal purchase is timed, said the same way everywhere: what PayPal answered in the
 * sandbox (content/public/e2e-transcript.json, refund_status COMPLETED) and how long PayPal says the money takes to reach
 * the buyer (its refund documentation, PROBLEM.refundTerms).
 */
export const REFUND_TIMING = {
  marked: "PayPal marked the refund to the original PayPal purchase COMPLETED at once",
  reach: `PayPal says a refund takes ${PROBLEM.refundTerms.reach} to reach the buyer`,
} as const;

/** "about 12 seconds" from a measured figure such as "12.3 s" or "17 to 18 s": the largest number, rounded. */
export function aboutSeconds(figure: string | null | undefined): number | null {
  const nums = [...(figure ?? "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.length ? Math.round(Math.max(...nums)) : null;
}
