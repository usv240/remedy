/**
 * Grounded in research: published findings Remedy is built on, each with what Remedy does about it. Every figure was
 * read from the source itself (2026-11-07): the paper, the experiment, the order, the post or the filing linked here.
 */
const FINDINGS: { fig: string; finding: string; source: string; url: string; inRemedy: string }[] = [
  {
    fig: "11.4%",
    finding:
      "A full refund lifts the share of recalled products that come back by 11.4% on average, across 338 CPSC recalls. It works two ways: owners see more benefit, and they feel more able to take part.",
    source: "Raithel, Hock and Mafael, Journal of the Academy of Marketing Science, 2024",
    url: "https://link.springer.com/article/10.1007/s11747-023-00967-x",
    inRemedy: "Each claim names the refund in its first line, and the remedy becomes up to four plain steps with a drawing for each.",
  },
  {
    fig: "14% to 31%",
    finding:
      "In an IRS field experiment with 35,050 tax filers, a simpler notice raised claiming from 14% to 23%, and naming the amount in the headline raised it to 31%.",
    source: "Bhargava and Manoli, American Economic Review, 2015",
    url: "https://www.aeaweb.org/articles?id=10.1257/aer.20121493",
    inRemedy: "One page on a phone, no account, and one photo. The checks explain each result in plain words.",
  },
  {
    fig: "6 in 100",
    finding: "Recalled products that come back through a recall, on average, by the CPSC's measure: every finished claim adds to it.",
    source: "CPSC Recall Effectiveness Workshop, 2017, as cited by Raithel, Hock and Mafael, 2024",
    url: "https://link.springer.com/article/10.1007/s11747-023-00967-x",
    inRemedy: "A finished claim takes one photo: the check runs in about 12 seconds and the PayPal payout in about 18, measured in the sandbox.",
  },
  {
    fig: "400,000+",
    finding:
      "Products covered by the CPSC's January 2025 order to Amazon: email each buyer directly, and refund the full price to anyone who submits proof the product was destroyed or disposed of.",
    source: "U.S. Consumer Product Safety Commission, January 17, 2025",
    url: "https://www.cpsc.gov/Newsroom/News-Releases/2025/CPSC-Issues-Final-Order-to-Amazon-com-Outlining-Remediation-Plans-for-Hazardous-Products",
    inRemedy: "The same pattern for any firm: buyers who paid with PayPal are found through Transaction Search, and each proof photo is checked and refunded.",
  },
  {
    fig: "10 bits",
    finding: "The difference hash (dHash) treats two pictures more than 10 bits apart as different images, and 1 to 10 bits as variations of one, after tests on over 150,000 images.",
    source: "Neal Krawetz, The Hacker Factor Blog, 2013",
    url: "https://www.hackerfactor.com/blog/index.php?/archives/529-Kind-of-Like-That.html",
    inRemedy: "A claim photo is matched within 10 bits to its own recall's pictures, and within 4 bits to the 1,777 distinct pictures of every other recall.",
  },
  {
    fig: "440 million",
    finding: "Active PayPal accounts at the end of September 2026.",
    source: "PayPal Holdings, third-quarter 2026 results, October 27, 2026",
    url: "https://www.sec.gov/Archives/edgar/data/1633917/000163391726000086/pypl3q-26earningsrelease.htm",
    inRemedy: "Refunds go back to the original PayPal purchase inside 180 days, or out as a PayPal payout to an email or phone number, with no bank details asked.",
  },
];

export const RESEARCH_SOURCES = FINDINGS.map((f) => ({ source: f.source, url: f.url }));

export function Research() {
  return (
    <ul className="jg">
      {FINDINGS.map((f) => (
        <li key={f.fig} className="jg-item" data-ui>
          <p className="jg-fig tabular">{f.fig}</p>
          <p className="jg-finding">{f.finding}</p>
          <p className="jg-in">
            <span className="jg-k">In Remedy. </span>
            {f.inRemedy}
          </p>
          <p className="jg-src">
            <a className="text-link" href={f.url} target="_blank" rel="noreferrer">
              {f.source}
            </a>
          </p>
        </li>
      ))}
    </ul>
  );
}
