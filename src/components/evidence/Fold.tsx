/**
 * One section of the evidence page, closed on load: its heading and one line of what it holds stay in view, and the
 * rest opens on a press, or when a link names the section or anything inside it (OpenOnHash keeps those links
 * working). Nothing is removed; the page opens short. The heading sits inside the summary, so the closed page still
 * reads as a list of headings, and the summary is the one control: Info buttons and links live in the body.
 */
export function Fold({ id, title, what, children }: { id: string; title: React.ReactNode; what: React.ReactNode; children: React.ReactNode }) {
  return (
    <details id={id} className="ev-fold">
      <summary className="ev-fold-sum">
        <span className="ev-fold-text">
          <h2 id={`${id}-h`} className="ev-fold-h">
            {title}
          </h2>
          <span className="ev-fold-what">{what}</span>
        </span>
        <svg className="ev-fold-mark" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="ev-fold-body">{children}</div>
    </details>
  );
}
