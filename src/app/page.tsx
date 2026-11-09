import { cacheLife } from "next/cache";
import Link from "next/link";
import stats from "../../content/recalls/stats.json";
import runs from "../../content/public/verify-runs.json";
import { Info } from "@/components/Info";
import { LitNames, type Source } from "@/components/landing/LitNames";
import { ShowcaseSearch } from "@/components/landing/ShowcaseSearch";
import { TourButton } from "@/components/landing/TourButton";
import { TryPanel, type PanelRun } from "@/components/landing/TryPanel";
import { cpscExampleDefault, MEASURED } from "@/components/evidence/data";
import { DEFAULT_TERMS } from "@/app/api/claims/_lib/terms";
import { REFUND_WINDOW_DAYS } from "@/lib/payments/refunds";
import { HEADLINE, shareParts } from "@/lib/recall/headline";
import { RecallLabel, SAMPLE_PHOTO_CREDIT } from "@/lib/recall/label";
import { PROBLEM, REFUND_TIMING, RESEARCH } from "@/lib/research";
import { catalogOfficialHashes } from "@/lib/verify/dhash";
import { checkTimeWords, errorRates } from "@/components/evidence/errors";
import { Contrast } from "@/components/evidence/Contrast";
import { docketWords } from "@/components/evidence/Docket";
import { moneyHeadline } from "@/components/evidence/Money";
import { fmtDate, fmtInt, shortTitle } from "@/lib/api/format";
import { findRecalls, recallByNumber, storedRule } from "@/lib/api/recall-data";
import "./landing-shared.css";
import "./landing.css";

/**
 * The home page ("The sentence is the layout").
 *
 * Idea: on this page, the recall's own instruction (send a photo of the product made safe) becomes the picture inside
 * the headline: the CPSC's published example photo of recall 26125, its cord cut in half, sits where a word would.
 * The live thing is the showcase: the section headline is an input, and every recall since 2024 answers as a checklist.
 * Every figure is read from content/recalls/stats.json; every check result from content/public/verify-runs.json.
 */

const C = stats.current;
const SHOWCASE_QUERY = "power bank";

/** The first showcase answer, cached into the static page: Elastic when connected, the in-app ranking otherwise. */
async function showcaseStart() {
  "use cache";
  cacheLife("days");
  try {
    const r = await findRecalls({ query: SHOWCASE_QUERY, limit: 3 });
    return { hits: r.hits, mode: r.mode as string };
  } catch {
    return { hits: [], mode: null };
  }
}

const STEPS = [
  { line: "First the recall is read.", note: "The official remedy becomes a checklist: what to cut or mark, and what the photo must show." },
  { line: "Then you snap a photo.", note: "On your phone, in under a minute. No account needed." },
  { line: "Then the photo is verified.", note: "Claude reads the photo; plain code decides the payout and the amount. Unclear cases get two AI reviewers, then a person." },
  { line: "Then PayPal pays you.", note: `To your PayPal or Venmo. Inside ${REFUND_WINDOW_DAYS} days of a PayPal purchase, straight back to how you paid.` },
];

/**
 * The three ideas that open how it works, each with the page that shows it running: what is new leads (the pool across
 * firms, with the docket replay's figure, and the payout nobody accepts turned into a task), then how the refund is
 * paid. Figures are read from the code and the data: the replay (content/public/docket-replay.json), the catalog of
 * distinct published pictures, the refund window.
 */
function ideas() {
  return [
    {
      line: "Each firm that joins makes every other firm safer.",
      note: `${docketWords()} Every claim photo is matched by two 64-bit hashes against the ${fmtInt(catalogOfficialHashes().length)} pictures published with every recall and every photo already claimed at any firm, before any model call. Firms share only hashes, never a photo.`,
      href: "/evidence#network",
      see: "One photo, two firms",
    },
    {
      line: "A payout nobody accepts becomes a task.",
      note: "When PayPal's webhook says a payout is waiting to be accepted, a re-notice appears in the firm's recall plan, live and linked to its payout batch, so the refund still reaches its owner.",
      href: "/firm/plan",
      see: "The recall plan",
    },
    {
      line: "The refund goes back the way it was paid.",
      note: `Inside PayPal's ${REFUND_WINDOW_DAYS}-day refund window, Remedy refunds the original PayPal purchase. After it, a PayPal payout to an email or phone, or Venmo. Plain code picks the route and the amount.`,
      href: "/try/shop",
      see: "Buy, claim and get it back",
    },
  ];
}

/** Remedy wording, word for word from the CPSC record. A quote that no longer matches the data is left out. */
const QUOTES = [
  { n: "27045", text: "Consumers will be asked to cut the pajamas in half and email a photo of the destroyed pajama set" },
  { n: "27056", text: "submit a photo of their recalled power bank with the word “recalled” written on it in permanent marker" },
  { n: "26754", text: "Consumers will be asked to cut the power cord and provide a photo of the destroyed product" },
];

/** Each source checked on 2026-11-05: `name` sets it in the sentence, `full` names it in the detail list. */
const SOURCES: (Source & { full: string; says: string })[] = [
  { name: "the CPSC Recalls API", full: "CPSC Recalls API", href: "/learn#data", says: "The public record of every US consumer product recall. Every figure on this page is counted from it, with the method on the Learn page." },
  {
    name: "the CPSC's 2025 refund order",
    full: "CPSC Decision and Order, January 16, 2025",
    href: "https://www.cpsc.gov/Newsroom/News-Releases/2025/CPSC-Issues-Final-Order-to-Amazon-com-Outlining-Remediation-Plans-for-Hazardous-Products",
    says: "For more than 400,000 products sold through Amazon, the order calls for direct notice to each buyer and a full refund to buyers who send proof the product was destroyed. Amazon has challenged the order in federal court.",
  },
  {
    name: "the Journal of the Academy of Marketing Science on full remedies",
    full: "Raithel, Hock and Mafael, Journal of the Academy of Marketing Science, 2024",
    href: "https://link.springer.com/article/10.1007/s11747-023-00967-x",
    says: `Across ${RESEARCH.fullRemedy.recalls} CPSC recalls from ${RESEARCH.fullRemedy.years}, ${RESEARCH.fullRemedy.what} (volume 52, pages 716 to 735).`,
  },
  {
    name: "the CPSC Recall Effectiveness Workshop",
    full: "CPSC Recall Effectiveness Workshop, 2017",
    href: "https://www.cpsc.gov/Recall-Effectiveness",
    says: "The CPSC's workshop and staff report on raising the share of owners who act on a recall: direct notice recalls are the most effective.",
  },
  {
    name: "the CPSC's FY2025 performance report",
    full: PROBLEM.correctionRate.source,
    href: PROBLEM.correctionRate.url,
    says: `The agency's own measure: an average correction rate of ${PROBLEM.correctionRate.rate} across all consumer product recalls in ${PROBLEM.correctionRate.year}, against a ${PROBLEM.correctionRate.target} target.`,
  },
  {
    name: "the CPSC's 2026 request on recall claims that are not genuine",
    full: PROBLEM.fraudRfi.source,
    href: PROBLEM.fraudRfi.url,
    says: "The agency's request for information on claims that are not genuine names coordinated claims through online forms and artificially generated destruction photos, and the cost of heavier verification to real owners.",
  },
  {
    name: "the CPSC Recall Handbook",
    full: "CPSC Product Safety Planning, Reporting, and Recall Handbook",
    href: "https://www.cpsc.gov/s3fs-public/RecallHandbookFINAL9_2technicalrevision_3052025.pdf",
    says: "The CPSC's guide for firms, including the monthly progress reports a firm sends during a recall. Remedy drafts them from its own numbers.",
  },
];

const TOOLS = [
  { tool: "PayPal", job: "Pays refunds in seconds, or back to the original purchase inside 180 days", href: "/stack#paypal" },
  { tool: "Claude Opus 5.5", job: "Reads each remedy into a checklist, checks photos, runs two reviewers", href: "/stack#claude" },
  { tool: "Elastic", job: "Searches every recall in plain words, keyword and semantic", href: "/stack#elastic" },
  { tool: "Channel3", job: "Finds a safe replacement product", href: "/stack#channel3" },
  { tool: "Bryntum", job: "The corrective-action plan", href: "/stack#bryntum" },
  { tool: "AG Grid", job: "The firm's claims queue", href: "/stack#ag-grid" },
  { tool: "APIMatic", job: "Generated the PayPal SDK behind every order, capture and refund", href: "/stack#apimatic" },
  { tool: "Render", job: "Hosting and Postgres", href: "/stack#render" },
];

const FAQ = [
  { q: "Do I need an account?", a: "No. Open the link from your recall notice, follow the checklist, and snap a photo. You only enter where to send the refund." },
  { q: "Where does the money go?", a: "To your PayPal or Venmo, or, if you bought with PayPal in the last 180 days, straight back to how you paid. This demo runs in PayPal's sandbox." },
  { q: "How is the photo checked?", a: "Remedy checks that it shows the recalled product, that it has been made safe as the recall asks, and that it is your own photo. Unclear photos get two AI reviewers and then a person at the firm." },
  { q: "Who pays the refund?", a: "The recalling company, from its own PayPal account. Remedy never holds the money. In this demo every refund comes from a PayPal sandbox account, so no real money moves: Remedy's own on real CPSC recalls, standing in for the recalling firm, and the sample firm's on its fictional sample recalls." },
  { q: "Is this connected to the CPSC?", a: "Remedy uses the CPSC's public recall data. It is an independent tool, not affiliated with the CPSC or any recalling firm." },
];

/** The stats column: whole part and decimals in their own tracks, so the figures align on the point. */
const FIGURES: { whole: string; dec?: string; caption: string }[] = [
  { whole: fmtInt(C.recalls.count), caption: `US consumer product recalls from ${fmtDate(C.range.from)} to ${fmtDate(C.range.to)}, from the CPSC` },
  { whole: fmtInt(HEADLINE.count), caption: "of them refund an owner for a photo of the product made safe" },
  { ...shareParts(HEADLINE.share), caption: "percent of all recalls in that time" },
  { whole: fmtInt(HEADLINE.byYear["2026"]), caption: `of those in 2026 so far, up from ${HEADLINE.byYear["2024"]} in 2024` },
  { whole: String(Math.trunc(C.all.under50k.share)), dec: `.${String(C.all.under50k.share).split(".")[1] ?? "0"}`, caption: "percent of recalls cover fewer than 50,000 units: mostly small firms" },
  { whole: String(C.all.paypalOrVenmo.count), caption: "recalls mention PayPal or Venmo anywhere in the remedy" },
];

type RunFile = { runs: { id: string; title: string; about: string; recall: string; settings?: string; result: { decision: string; decided_by: string; summary: { plain: string }; guidance?: { plain: string } | null; amount?: { value: string } | null; timings: { total_ms: number; vision_ms?: number; reviewers_ms?: number }; checks: Record<string, { name: string; status: string; score: number | null; reason: string; technical: string }> } }[] };

/**
 * The panel's tabs, in order. The first is the whole automatic path: Brightline's sample charger with its cord cut,
 * verified, then the refund. The second is the photo in the headline, answered the way a claim answers it.
 */
const PRESETS: { id: string; pick: string; thumb: string; w: number; h: number; credit: string }[] = [
  { id: "sample-charger-cut", pick: "Charger, cord cut", thumb: "/landing/charger-cord-cut.webp", w: 360, h: 270, credit: `${SAMPLE_PHOTO_CREDIT}. Sample recall; fictional.` },
  { id: "cpsc-example", pick: "The CPSC's photo", thumb: "/landing/cord-cut-26125-sm.webp", w: 360, h: 230, credit: "Photo: CPSC, recall 26125." },
  { id: "official-image-power-bank", pick: "Official picture", thumb: "/landing/power-bank-27056.webp", w: 217, h: 322, credit: "Photo: CPSC, recall 27056." },
  { id: "blurry", pick: "Blurry photo", thumb: "/landing/blurry-mug.webp", w: 360, h: 270, credit: "Photo: Kurt Kaiser, CC0, via Wikimedia Commons, blurred by us." },
];

const measured = (id: string) => MEASURED.items.find((i) => i.id === id)?.figure ?? null;
/** The recall's short title; the label beside it already says when it is a sample recall. */
const panelTitle = (title: string) => shortTitle(title).replace(/\s*\(sample recall\)$/i, "");

/**
 * For a run the two reviewers settled: its own times, then what a check takes across every recorded live run, said the
 * way the data does (checkTimeWords in src/components/evidence/errors.ts, the one source the try section shares).
 */
function timingsFor(t?: { vision_ms?: number; reviewers_ms?: number; total_ms?: number }): string | null {
  return t?.vision_ms && t.reviewers_ms ? checkTimeWords(t.total_ms).flagship : null;
}

function nextFor(decision: string, decidedBy: string, checks: Record<string, { status: string; score: number | null }>, guidance: string | null, summary: string): string {
  if (decision === "verified" && decidedBy === "reviewers") {
    return "Both reviewers found the recalled charger with its cord cut. Code checked their evidence and the amount, and verified it.";
  }
  if (decision === "verified") return "Every check passed. Code checked the amount, and verified it.";
  if (decision === "retake") return guidance ? `${guidance} Nothing is paid until the photo checks out.` : summary;
  return "Two AI reviewers and then a person at the firm take a look.";
}

/**
 * The four sample runs. Recorded runs come from content/public/verify-runs.json. The 26125 photo, the one set into the
 * headline, runs live through the claim path with no model call: the free picture match recognizes the CPSC's own
 * published photo and asks for the owner's own.
 */
async function panelRuns(): Promise<PanelRun[]> {
  const all = (runs as RunFile).runs;
  const cpsc = await cpscExampleDefault();
  return PRESETS.flatMap((p): PanelRun[] => {
    if (p.id === "cpsc-example") {
      const rec = recallByNumber("26125");
      if (!cpsc || !rec) return [];
      return [
        {
          id: p.id,
          pick: p.pick,
          title: "The CPSC's own made-safe photo",
          about: "The photo in the headline: the CPSC published it with recall 26125 to show the hair dryer made safe. Here it is sent as if it were an owner's claim photo.",
          thumb: p.thumb,
          thumbW: p.w,
          thumbH: p.h,
          credit: p.credit,
          recall: { label: RecallLabel(rec.number), title: panelTitle(rec.title) },
          decision: cpsc.decision as PanelRun["decision"],
          reviewersSettled: false,
          next: "This is the CPSC's own published photo of the cut cord, so the free picture match finds it in code, with no model call, and Remedy asks the owner for a photo of their own hair dryer made safe.",
          totalMs: cpsc.totalMs,
          settings: null,
          checks: cpsc.checks,
          paid: null,
        },
      ];
    }
    const r = all.find((x) => x.id === p.id);
    const rec = r ? recallByNumber(r.recall) : null;
    if (!r || !rec) return [];
    const res = r.result;
    const verified = res.decision === "verified";
    const payout = measured("payout");
    return [
      {
        id: r.id,
        pick: p.pick,
        title: r.title,
        about: r.about,
        thumb: p.thumb,
        thumbW: p.w,
        thumbH: p.h,
        credit: p.credit,
        recall: { label: RecallLabel(rec.number), title: panelTitle(rec.title) },
        decision: res.decision as PanelRun["decision"],
        reviewersSettled: res.decision === "verified" && res.decided_by === "reviewers",
        next: nextFor(res.decision, res.decided_by, res.checks, res.guidance?.plain ?? null, res.summary.plain),
        more: res.decided_by === "reviewers" ? timingsFor(res.timings) : null,
        totalMs: res.timings.total_ms,
        settings: r.settings ?? null,
        checks: Object.entries(res.checks).map(([id, c]) => ({ id, ...c })),
        paid:
          verified && res.amount
            ? {
                line: `$${res.amount.value} back through PayPal, sent at once`,
                note: `Under Brightline's $${(DEFAULT_TERMS.autoCapCents / 100).toFixed(2)} auto-approve cap, so no person is needed.`,
                more: `Bought with PayPal, it goes back to that purchase: ${REFUND_TIMING.marked.replace(/^PayPal marked the refund to the original PayPal purchase/, "PayPal marked it")}, and ${REFUND_TIMING.reach.replace(/^PayPal says/, "says")}. Otherwise it is a payout to an email or phone${payout ? `, which reached SUCCESS in ${payout}` : ""}.`,
                href: "/try/shop",
                cta: "Buy the charger in the sandbox and claim it",
              }
            : null,
      },
    ];
  });
}

function devFragment() {
  const rule = storedRule("27056")?.rule;
  if (!rule) return null;
  const body = { photo_required: rule.photo_required, actions: rule.actions, marker_text: rule.marker_text, must_show: rule.must_show, remedy: rule.remedy, steps: rule.steps.slice(0, 2) };
  // Short arrays of words stay on one line, as a person would write them; the steps keep one line each.
  const json = JSON.stringify(body, null, 2).replace(/\[\n\s+("[^"\n]{0,24}")(?:,\n\s+("[^"\n]{0,24}"))?\n\s+\]/g, (_m, a: string, b?: string) => `[${a}${b ? `, ${b}` : ""}]`);
  return `POST /api/v1/proof-rule
{ "recall_number": "27056" }

200 OK
{ "data": { "rule": ${json.replace(/\n/g, "\n    ")} } }`;
}

/** One remedy, word for word, running on into its recall number. */
function Quote({ q }: { q: (typeof QUOTES)[number] }) {
  return (
    <li>
      <blockquote cite={`/recalls/${q.n}`}>&ldquo;{q.text}&hellip;&rdquo;</blockquote>
      <Link className="intro-q-src text-link" href={`/recalls/${q.n}`}>
        Recall {q.n}
      </Link>
    </li>
  );
}

export default async function Home() {
  const start = await showcaseStart();
  const quotes = QUOTES.filter((q) => recallByNumber(q.n)?.remedyText.includes(q.text));
  const fragment = devFragment();
  // The one measured result the first screen states: the error rate (src/components/evidence/errors.ts). How long a
  // check takes sits with the example that shows it (the try section); the payout's time with the contrast.
  const rates = errorRates();
  const money = moneyHeadline();
  const times = checkTimeWords();
  const proof = { wrongPay: `${rates.wrongPay.count} of ${rates.wrongPay.of}` };

  return (
    <>
      <section className="hero frame" aria-labelledby="hero-h">
        <div className="hero-sky">
          <h1 id="hero-h" className="hero-h">
            <span className="hero-line">Recall refunds</span>
            <span className="hero-line hero-line-2">
              <span className="hero-slot" aria-hidden="true">
                <img className="hero-slot-img" src="/landing/cord-cut-26125.webp" alt="" width={682} height={436} fetchPriority="high" />
              </span>{" "}
              in seconds
            </span>
          </h1>
        </div>
        {/* The Info button closes the sentence it explains, instead of floating alone under the headline. */}
        <p className="hero-horizon">
          <span className="hero-half hero-half-a">Snap the product made safe.</span>{" "}
          <span className="hero-half hero-half-b">
            AI checks it. PayPal pays you. <Info id="page.home" topic="Remedy" />
          </span>
        </p>
        {/* The first screen holds one result and one action; everything else is further down the page. */}
        <p className="hero-result">
          <strong className="tabular">{proof.wrongPay}</strong> paid wrongly on photos with a known answer.{" "}
          <Link className="text-link" href="/evidence#errors">
            How it was measured
          </Link>
        </p>
        <div className="hero-actions">
          <Link href="/try" className="btn btn-primary hero-cta">
            Try a photo
          </Link>
        </div>
        <p className="hero-note">In the headline: the CPSC&rsquo;s photo for recall 26125, a hair dryer with its cord cut in half.</p>
      </section>

      <section id="intro" className="intro" aria-labelledby="intro-h">
        <div className="intro-grid frame">
          <h2 id="intro-h" className="intro-h">
            <span className="intro-l1">Many recalls</span>
            <span className="intro-l2">
              <span className="intro-ink">ask for a photo</span>
              <span className="intro-ink intro-ink-on" aria-hidden="true">
                ask for a photo
              </span>
            </span>
          </h2>
          <figure className="intro-photo">
            <img
              src="/landing/helmet-straps-25007.webp"
              srcSet="/landing/helmet-straps-25007-sm.webp 600w, /landing/helmet-straps-25007.webp 1100w"
              sizes="(max-width: 760px) 75vw, 50vw"
              alt="A recalled bike helmet seen from inside, with both chin straps cut off and laid above it on white paper."
              width={1100}
              height={1338}
              loading="lazy"
            />
            <figcaption>Recall 25007: the CPSC&rsquo;s example of a photo the firm accepts, the helmet&rsquo;s straps cut off. Photo: CPSC.</figcaption>
          </figure>
          <div className="intro-text">
            <p className="intro-stat">
              Since January 2024, <span className="tabular">{fmtInt(HEADLINE.count)}</span> of <span className="tabular">{fmtInt(C.recalls.count)}</span> US product recalls refund an owner who sends a photo of the
              product made safe, and the number grows each year: <span className="tabular">{HEADLINE.byYear["2024"]}</span> in 2024, <span className="tabular">{HEADLINE.byYear["2025"]}</span> in 2025 and{" "}
              <span className="tabular">{HEADLINE.byYear["2026"]}</span> so far in 2026.{" "}
              <Info id="intro.stat" label="" topic={`How ${fmtInt(HEADLINE.count)} was counted`} />
            </p>
            <Contrast className="vs intro-vs" />
            <details className="intro-more">
              <summary>What is at stake</summary>
              <p className="intro-money">
                Those refunds come to <strong className="tabular">{money.total}</strong> at the lowest stated prices, and <strong className="tabular">{money.range}</strong> of it goes unclaimed, at the CPSC&rsquo;s {money.correctionRate} correction
                rate and at its figure of about {money.share} products that come back. {money.concentration}{" "}
                <Link className="text-link" href="/evidence/market#money">
                  How it was counted
                </Link>
              </p>
              {quotes.length > 0 && (
                <ul className="intro-quotes" aria-label="In the recalls' own words">
                  <Quote q={quotes[0]} />
                </ul>
              )}
            </details>
            <details className="intro-more">
              <summary>Why reaching owners directly matters</summary>
              <p className="intro-why">
                Reaching owners directly is what works: about {RESEARCH.directNotice.direct} of products are corrected when the firm contacts its buyers, against {RESEARCH.directNotice.press} after a press release (
                <a className="text-link" href={RESEARCH.directNotice.url} target="_blank" rel="noreferrer">
                  {RESEARCH.directNotice.short}
                </a>
                ). Across {RESEARCH.fullRemedy.recalls} CPSC recalls from {RESEARCH.fullRemedy.years}, {RESEARCH.fullRemedy.what} (
                <a className="text-link" href={RESEARCH.fullRemedy.url} target="_blank" rel="noreferrer">
                  {RESEARCH.fullRemedy.short}
                </a>
                ).
              </p>
              <p className="intro-why">
                By the CPSC&rsquo;s own measure, its average correction rate across recalls was {PROBLEM.correctionRate.rate} in {PROBLEM.correctionRate.year}, against its {PROBLEM.correctionRate.target} target (
                <a className="text-link" href={PROBLEM.correctionRate.url} target="_blank" rel="noreferrer">
                  {PROBLEM.correctionRate.short}
                </a>
                ). In April 2026 the agency asked the public how to catch artificially generated destruction photos and coordinated claims without adding burdens for real owners (
                <a className="text-link" href={PROBLEM.fraudRfi.url} target="_blank" rel="noreferrer">
                  {PROBLEM.fraudRfi.short}
                </a>
                ). Firms already pay photo-proof refunds by PayPal: a June 2026 recall page offers PayPal or a gift card and calls PayPal fastest (
                <a className="text-link" href={PROBLEM.paypalPortal.url} target="_blank" rel="noreferrer">
                  {PROBLEM.paypalPortal.short}
                </a>
                ), while a 2025 page asks owners to allow {PROBLEM.weeksPortal.wait} (
                <a className="text-link" href={PROBLEM.weeksPortal.url} target="_blank" rel="noreferrer">
                  {PROBLEM.weeksPortal.short}
                </a>
                ).{" "}
                <Link className="text-link" href="/evidence/market#problem">
                  Every finding, with what Remedy does about it
                </Link>
              </p>
            </details>
          </div>
          <figure className="intro-photo-2">
            <img src="/landing/helmet-trash-25007.webp" alt="The same helmet and its cut straps inside a kitchen trash can." width={720} height={705} loading="lazy" />
            <figcaption>The second photo it asks for: helmet and straps in the trash. Photo: CPSC.</figcaption>
          </figure>
        </div>
      </section>

      <section id="how" className="how frame" aria-labelledby="ideas-h">
        <div className="ideas">
          <h2 id="ideas-h" className="ideas-h" data-reveal="">
            Three ideas behind every refund
          </h2>
          <ol className="ideas-list">
            {ideas().map((d, i) => (
              <li key={d.line} className="ideas-item" data-reveal="" style={{ "--reveal-i": i } as React.CSSProperties}>
                {/* The first idea opens with the page: the pool across firms and the docket replay's figure lead. */}
                <details className="ideas-more" open={i === 0}>
                  <summary className="ideas-line">{d.line}</summary>
                  <p className="ideas-note">
                    {d.note}{" "}
                    <Link className="text-link ideas-see" href={d.href}>
                      {d.see}
                    </Link>
                  </p>
                </details>
              </li>
            ))}
          </ol>
        </div>
        <ol className="how-steps">
          {STEPS.map((s, i) => (
            <li key={s.line} className="how-step" data-reveal="" style={{ "--reveal-i": i } as React.CSSProperties}>
              {i === 0 ? (
                <h2 id="how-h" className="how-line">
                  {s.line} <Info id="how.steps" label="" topic="How it works" />
                </h2>
              ) : (
                <p className="how-line" data-last={i === STEPS.length - 1 ? "" : undefined}>
                  {s.line}
                </p>
              )}
              <p className="how-note">{s.note}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="showcase" className="showcase frame" aria-labelledby="showcase-h">
        <h2 id="showcase-h" className="sr-only">
          Search every recall
        </h2>
        <div className="showcase-info">
          <Info id="showcase.search" label="" topic="Recall search" />
        </div>
        <ShowcaseSearch initialQuery={SHOWCASE_QUERY} initialHits={start.hits} initialMode={start.mode} />
      </section>

      <section id="try" className="try frame" aria-labelledby="try-h">
        <div className="try-statement" data-reveal="">
          <h2 id="try-h" className="try-h">
            See a photo become a refund
          </h2>
          <p className="try-p">
            Start with Brightline&rsquo;s sample charger: verified, then refunded through PayPal. A check takes {times.short}.{" "}
            <Info id="try.panel" label="" topic="The photo checks" />
          </p>
          <p className="try-actions">
            <Link className="btn btn-primary" href="/try">
              Try a photo
            </Link>
            <TourButton className="text-link try-tour" label="Or take the 2-minute tour" />
          </p>
        </div>
        <div className="try-fragment" data-reveal="" style={{ "--reveal-i": 1 } as React.CSSProperties}>
          <TryPanel runs={await panelRuns()} />
        </div>
      </section>

      <section id="numbers" className="stats frame" aria-labelledby="stats-h">
        <div className="stats-head" data-reveal="">
          <h2 id="stats-h" className="stats-h">
            <span className="stats-h1">A bigger share</span> <span className="stats-h2">every year</span>
          </h2>
          <p className="stats-src">
            From the CPSC Recalls API, pulled {fmtDate(C.pulledAt.slice(0, 10))}.{" "}
            <Link className="text-link" href="/learn#data">
              How we counted
            </Link>
          </p>
          {/* The sources sit under the heading the figures answer, so the column beside the figures carries its proof. */}
          <div id="research" className="stats-research">
            <h3 className="sr-only">Grounded in research</h3>
            <LitNames lead="Grounded in" sources={SOURCES} />
            <div className="rs-foot">
              <Link className="text-link" href="/evidence#research">
                What each source says
              </Link>
            </div>
          </div>
        </div>
        <dl className="stats-list">
          {FIGURES.map((f, i) => (
            <div key={f.caption} className="stats-row" data-reveal="" style={{ "--reveal-i": i } as React.CSSProperties}>
              <dt className="stats-fig tabular">
                <span className="stats-whole">{f.whole}</span>
                <span className="stats-dec">{f.dec ?? ""}</span>
              </dt>
              <dd className="stats-cap">{f.caption}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="built" className="built frame" aria-labelledby="built-h">
        <h2 id="built-h" className="built-h" data-reveal="">
          <span>Every tool</span> <span>has one job</span>
        </h2>
        <div className="built-body">
          <p className="built-k">Tools</p>
          <ul className="built-table">
            {TOOLS.map((t) => (
              <li key={t.tool} className="built-row">
                <Link href={t.href} className="built-link">
                  <span className="built-tool">{t.tool}</span>
                  <span className="built-job">{t.job}</span>
                  <span className="built-arrow" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="built-more">
            <Link className="text-link" href="/stack">
              How each one is wired, with its files
            </Link>
          </p>
        </div>
      </section>

      <section id="developers" className="devs frame" aria-labelledby="devs-h">
        <div className="devs-statement" data-reveal="">
          <h2 id="devs-h" className="devs-h">
            For developers
          </h2>
          <p className="devs-p">Add verify-and-refund to any recall page. One API call, or our MCP server for AI agents.</p>
          <p className="devs-actions">
            <Link className="btn btn-ink" href="/developers#key-h">
              Get an API key
            </Link>
            <Link className="text-link" href="/developers/docs">
              Read the docs
            </Link>
          </p>
        </div>
        {fragment && (
          <figure className="devs-fragment" data-ui data-reveal="" style={{ "--reveal-i": 1 } as React.CSSProperties}>
            <figcaption className="devs-cap">
              A real answer, from this recall&rsquo;s stored rule <Info id="dev.fragment" label="" topic="This example" />
            </figcaption>
            <pre className="devs-pre" tabIndex={0} aria-label="Example request and response">
              <code>{fragment}</code>
            </pre>
          </figure>
        )}
      </section>

      <section id="faq" className="faq frame" aria-labelledby="faq-h">
        <h2 id="faq-h" className="faq-h">
          Questions
        </h2>
        <div className="faq-list">
          {FAQ.map((f) => (
            <details key={f.q} className="faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="cta frame" aria-labelledby="cta-h">
        <h2 id="cta-h" className="cta-h">
          <span>Refunds,</span> <span>in seconds</span>
        </h2>
        <div className="cta-foot">
          <p className="cta-p">Pick a recall, snap a photo, and watch the sandbox payout arrive.</p>
          <Link href="/try" className="btn btn-primary cta-btn">
            Try a photo
          </Link>
        </div>
      </section>
    </>
  );
}
