import { Info } from "@/components/Info";
import { CopyButton } from "./CopyButton";

/** The two badges every visitor can see live, with the iframe and one-script snippets to copy. */
const PREVIEWS = [
  { recall: "27056", label: "CPSC recall 27056, HAIARA power banks (write RECALLED, full refund)" },
  { recall: "BH-2026-01", label: "Sample recall BH-2026-01, Brightline Home's 65W laptop chargers (fictional firm)" },
] as const;

export function EmbedBadge({ host }: { host: string }) {
  const iframe = (n: string) => `<iframe src="${host}/api/embed/badge?recall=${n}" title="Recall badge" loading="lazy" style="border:0;width:100%;max-width:28rem;height:7.5rem"></iframe>`;
  const script = `<script src="${host}/api/embed/badge.js" data-recall="27056" async></script>`;
  return (
    <section className="page-section dev-embed" aria-labelledby="embed-h">
      <div className="title-row">
        <h2 id="embed-h">Embed a recall badge</h2>
        <Info id="dev.embed" label="" topic="the recall badge" />
      </div>
      <p className="page-prose">
        One iframe, or one script tag, on any product page: the recall&rsquo;s one-line remedy and refund, with a <q>Get your refund</q> link to the owner&rsquo;s claim page. Rendered on our server in Remedy&rsquo;s colors, light or dark with the visitor&rsquo;s setting. Use <code>?recall=</code> with a recall number or <code>?q=</code> with the product in plain words.
      </p>
      <div className="dev-embed-grid">
        {PREVIEWS.map((p) => (
          <figure key={p.recall} className="dev-first dev-embed-fig" data-ui>
            <div className="dev-first-head">
              <figcaption>Live: {p.label}</figcaption>
            </div>
            <iframe className="dev-embed-frame" src={`/api/embed/badge?recall=${p.recall}`} title={`Recall badge for ${p.recall}`} loading="lazy" />
            <div className="dev-first-head">
              <code className="dev-embed-src tabular">{`<iframe src="${host}/api/embed/badge?recall=${p.recall}" ...>`}</code>
              <CopyButton text={iframe(p.recall)} label="Copy iframe" />
            </div>
          </figure>
        ))}
      </div>
      <figure className="dev-first dev-embed-script" data-ui>
        <div className="dev-first-head">
          <figcaption>One script instead of an iframe</figcaption>
          <CopyButton text={script} label="Copy" />
        </div>
        <pre className="dev-pre tabular" tabIndex={0} aria-label="The one-script embed">
          {script}
        </pre>
        <p className="dev-first-note">
          The script inserts the same iframe where it sits; <code>data-q=&quot;power bank&quot;</code> works instead of a recall number, and <code>data-width</code> and <code>data-height</code> size it. Nothing else loads on your page.
        </p>
      </figure>
    </section>
  );
}
