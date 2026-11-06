import { cacheLife } from "next/cache";
import Link from "next/link";
import stats from "../../content/recalls/stats.json";
import runs from "../../content/public/verify-runs.json";
import { Info } from "@/components/Info";
import { LitNames, type Source } from "@/components/landing/LitNames";
import { ShowcaseSearch } from "@/components/landing/ShowcaseSearch";
import { TourButton } from "@/components/landing/TourButton";
import { TryPanel, type PanelRun } from "@/components/landing/TryPanel";
import { fmtDate, fmtInt, shortTitle } from "@/lib/api/format";
import { findRecalls, recallByNumber, storedRule } from "@/lib/api/recall-data";
import "./landing-shared.css";
import "./landing.css";

/**
 * The home page (plan section 4; direction .taste-skill/remedy-sheet.txt, "The sentence is the layout").
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
  { line: "First the recall is read.", note: "Remedy turns the official remedy into a clear checklist: what to cut or mark, and what the photo must show." },
  { line: "Then you snap a photo.", note: "On your phone, in under a minute. No account needed." },
  { line: "Then the photo is verified.", note: "Right product, made safe, your own photo. Unclear cases get two AI reviewers and a person at the firm." },
  { line: "Then PayPal pays you.", note: "To your PayPal or Venmo. Inside 180 days of a PayPal purchase, straight back to how you paid." },
];

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
    says: "Their study of CPSC recalls finds that recall effectiveness improves by 11.4% on average when firms offer a full remedy instead of a partial one (volume 52, pages 716 to 735).",
  },
  {
    name: "the CPSC Recall Effectiveness Workshop",
    full: "CPSC Recall Effectiveness Workshop, 2017",
    href: "https://www.cpsc.gov/Recall-Effectiveness",
    says: "The CPSC's workshop and staff report on raising the share of owners who act on a recall, which is about 6% on average for consumer products.",
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
  { tool: "Elastic", job: "Searches every recall in plain words", href: "/stack#elastic" },
  { tool: "Channel3", job: "Finds a safe replacement product", href: "/stack#channel3" },
  { tool: "Bryntum", job: "The corrective-action plan", href: "/stack#bryntum" },
  { tool: "AG Grid", job: "The firm's claims queue", href: "/stack#ag-grid" },
  { tool: "KERNEL", job: "Reads recall pages and firm recall sites", href: "/stack#kernel" },
  { tool: "Render", job: "Hosting, Postgres and payout jobs", href: "/stack#render" },
  { tool: "APIMatic", job: "PayPal's SDK for building, and our API's SDKs", href: "/stack#apimatic" },
];

const FAQ = [
  { q: "Do I need an account?", a: "No. Open the link from your recall notice, follow the checklist, and snap a photo. You only enter where to send the refund." },
  { q: "Where does the money go?", a: "To your PayPal or Venmo, or, if you bought with PayPal in the last 180 days, straight back to how you paid. This demo runs in PayPal's sandbox." },
  { q: "How is the photo checked?", a: "Remedy checks that it shows the recalled product, that it has been made safe as the recall asks, and that it is your own photo. Unclear photos get two AI reviewers and then a person at the firm." },
  { q: "What if my photo needs another try?", a: "You will see exactly what to change, and you can take a new photo right away." },
  { q: "Who pays the refund?", a: "The recalling company, from its own PayPal account. Remedy never holds the money." },
  { q: "Is this connected to the CPSC?", a: "Remedy uses the CPSC's public recall data and helps firms prepare their monthly progress reports. It is an independent tool, not affiliated with the CPSC or any recalling firm." },
];

/** The stats column: whole part and decimals in their own tracks, so the figures align on the point. */
const FIGURES: { whole: string; dec?: string; caption: string }[] = [
  { whole: fmtInt(C.recalls.count), caption: `US consumer product recalls from ${fmtDate(C.range.from)} to ${fmtDate(C.range.to)}, from the CPSC` },
  { whole: fmtInt(C.all.photoRefund.count), caption: "of them offer a refund for a photo of the product made safe" },
  { whole: String(Math.trunc(C.all.photoRefund.share)), dec: `.${String(C.all.photoRefund.share).split(".")[1] ?? "0"}`, caption: "percent of all recalls in that time" },
  { whole: fmtInt(C.byYear["2026"].photoRefund), caption: `photo-refund recalls in 2026 so far, up from ${C.byYear["2024"].photoRefund} in 2024` },
  { whole: String(Math.trunc(C.all.under50k.share)), dec: `.${String(C.all.under50k.share).split(".")[1] ?? "0"}`, caption: "percent of recalls cover fewer than 50,000 units: mostly small firms" },
  { whole: String(C.all.paypalOrVenmo.count), caption: "recalls mention PayPal or Venmo anywhere in the remedy" },
];

type RunFile = { runs: { id: string; title: string; about: string; recall: string; settings?: string; result: { decision: string; decided_by: string; summary: { plain: string }; guidance?: { plain: string } | null; timings: { total_ms: number }; checks: Record<string, { name: string; status: string; score: number | null; reason: string; technical: string }> } }[] };

const PRESETS: { id: string; thumb: string; w: number; h: number; credit: string }[] = [
  { id: "cord-cut-example", thumb: "/landing/cord-cut-26125-sm.webp", w: 360, h: 230, credit: "Photo: CPSC, recall 26125." },
  { id: "official-image-power-bank", thumb: "/landing/power-bank-27056.webp", w: 217, h: 322, credit: "Photo: CPSC, recall 27056." },
  { id: "blurry", thumb: "/landing/blurry-mug.webp", w: 360, h: 270, credit: "Photo: Kurt Kaiser, CC0, via Wikimedia Commons, blurred by us." },
];

function nextFor(r: RunFile["runs"][number]): string {
  const res = r.result;
  if (res.decision === "verified") return "Every check passed. The refund is ready to send through PayPal.";
  if (res.decision === "retake") return res.guidance?.plain ? `${res.guidance.plain} Nothing is paid until the photo checks out.` : res.summary.plain;
  const c1 = res.checks.C1;
  if (c1?.status === "unclear" && c1.score !== null)
    return `The cut cord is confirmed. With no official picture to compare in this run, the product match is ${c1.score.toFixed(2)}, just under the 0.85 bar, so two AI reviewers and then a person at the firm take a look.`;
  return "Two AI reviewers and then a person at the firm take a look.";
}

function panelRuns(): PanelRun[] {
  const all = (runs as RunFile).runs;
  return PRESETS.flatMap((p) => {
    const r = all.find((x) => x.id === p.id);
    const rec = r ? recallByNumber(r.recall) : null;
    if (!r || !rec) return [];
    return [
      {
        id: r.id,
        title: r.title,
        about: r.about,
        thumb: p.thumb,
        thumbW: p.w,
        thumbH: p.h,
        credit: p.credit,
        recall: { number: rec.number, title: shortTitle(rec.title) },
        decision: r.result.decision as PanelRun["decision"],
        next: nextFor(r),
        totalMs: r.result.timings.total_ms,
        settings: r.settings ?? null,
        checks: Object.entries(r.result.checks).map(([id, c]) => ({ id, ...c })),
      },
    ];
  });
}

function devFragment() {
  const rule = storedRule("27056")?.rule;
  if (!rule) return null;
  const body = { photo_required: rule.photo_required, actions: rule.actions, marker_text: rule.marker_text, must_show: rule.must_show, remedy: rule.remedy, steps: rule.steps.slice(0, 2) };
  return `POST /api/v1/proof-rule
{ "recall_number": "27056" }

200 OK
{ "data": { "rule": ${JSON.stringify(body, null, 2).replace(/\n/g, "\n    ")} } }`;
}

export default async function Home() {
  const start = await showcaseStart();
  const quotes = QUOTES.filter((q) => recallByNumber(q.n)?.remedyText.includes(q.text));
  const fragment = devFragment();

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
          <Info id="page.home" topic="Remedy" />
        </div>
        <p className="hero-horizon">
          <span className="hero-half hero-half-a">Snap the product made safe.</span> <span className="hero-half hero-half-b">AI checks it. PayPal pays you.</span>
        </p>
        <div className="hero-actions">
          <Link href="/try" className="btn btn-primary hero-cta">
            Try a photo
          </Link>
          <a href="#showcase" className="text-link hero-link">
            Find your recall
          </a>
          <TourButton className="text-link hero-link" />
        </div>
        <p className="hero-note">
          In the headline: a hair dryer with its cord cut in half, the photo the CPSC published with recall 26125 to show it made safe.
        </p>
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
              Since January 2024, <span className="tabular">{fmtInt(C.all.photoRefund.count)}</span> of <span className="tabular">{fmtInt(C.recalls.count)}</span> US product recalls offer a refund once the owner
              sends a photo of the product made safe. <Info id="intro.stat" label="" topic="How 525 was counted" />
            </p>
            <p className="intro-lead">Remedy turns that photo into a refund in seconds.</p>
            {quotes.length > 0 && (
              <ul className="intro-quotes" aria-label="In the recalls' own words">
                {quotes.map((q) => (
                  <li key={q.n}>
                    <blockquote cite={`/recalls/${q.n}`}>&ldquo;{q.text}&hellip;&rdquo;</blockquote>
                    <Link className="intro-q-src text-link" href={`/recalls/${q.n}`}>
                      Recall {q.n}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <figure className="intro-photo-2">
            <img src="/landing/helmet-trash-25007.webp" alt="The same helmet and its cut straps inside a kitchen trash can." width={720} height={705} loading="lazy" />
            <figcaption>The second photo it asks for: helmet and straps in the trash. Photo: CPSC.</figcaption>
          </figure>
        </div>
      </section>

      <section id="how" className="how frame" aria-labelledby="how-h">
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
            Use one of ours, or your own. These are recorded runs of Remedy&rsquo;s verifier on real recall photos; the live run, with a sandbox payout, is one press away.{" "}
            <Info id="try.panel" label="" topic="The photo checks" />
          </p>
          <p className="try-actions">
            <Link className="btn btn-primary" href="/try">
              Try a photo
            </Link>
          </p>
        </div>
        <div className="try-fragment" data-reveal="" style={{ "--reveal-i": 1 } as React.CSSProperties}>
          <TryPanel runs={panelRuns()} />
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
            </Link>{" "}
            <Info id="stats.figures" label="" topic="These figures" />
          </p>
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

      <section id="research" className="research frame" aria-labelledby="research-h">
        <h2 id="research-h" className="sr-only">
          Grounded in research
        </h2>
        <div className="rs-info">
          <Info id="research.row" label="" topic="The sources" />
        </div>
        <LitNames lead="Grounded in" sources={SOURCES} />
        <details className="rs-more">
          <summary>What each source says</summary>
          <ul className="rs-list">
            {SOURCES.map((s) => (
              <li key={s.href}>
                <a className="text-link" href={s.href} target={s.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                  {s.full}
                </a>
                . {s.says}
              </li>
            ))}
          </ul>
        </details>
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
          <p className="devs-p">Add verify-and-refund to any recall page. One API call, signed webhooks, or our MCP server for AI agents.</p>
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
