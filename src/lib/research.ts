/**
 * The published findings Remedy is built on, each figure read from the source itself (2026-11-07): the paper, the
 * experiment, the order, the post or the filing linked here. The one place these figures live: /evidence#research,
 * the home page and the README all read them from here (tests/facts.test.ts checks the README). Pure.
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

/** "about 12 seconds" from a measured figure such as "12.3 s" or "17 to 18 s": the largest number, rounded. */
export function aboutSeconds(figure: string | null | undefined): number | null {
  const nums = [...(figure ?? "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.length ? Math.round(Math.max(...nums)) : null;
}
