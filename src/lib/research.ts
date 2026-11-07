/**
 * The published findings Remedy is built on, each figure read from the source itself (2026-11-07): the paper, the
 * experiment, the order, the post or the filing linked here. The one place these figures live: /evidence#research,
 * the home page and the README all read them from here (tests/facts.test.ts checks the README). Pure.
 */
export const RESEARCH = {
  fullRemedy: {
    lift: "11.4%",
    recalls: 338,
    source: "Raithel, Hock and Mafael, Journal of the Academy of Marketing Science, 2024",
    short: "Raithel, Hock and Mafael, 2024",
    url: "https://link.springer.com/article/10.1007/s11747-023-00967-x",
  },
  simpler: {
    from: "14%",
    to: "23%",
    named: "31%",
    filers: "35,050",
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
