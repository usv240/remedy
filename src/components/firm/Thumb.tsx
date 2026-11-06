/**
 * A claim's photo, or for a sample claim with no photo a small drawing in code: the product outline, with the marker
 * line when the check found it made safe. Drawings use currentColor, so they follow the theme.
 */
export function Thumb({ url, made, size = 40, label }: { url: string | null; made: boolean; size?: number; label: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="cq-thumb" src={url} alt={label} width={size} height={size} loading="lazy" decoding="async" style={{ width: size, height: size }} />;
  }
  return (
    <svg className="cq-thumb" viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={`${label}. Sample claim: a drawing, no photo stored`} style={{ width: size, height: size, color: "var(--muted)" }}>
      <rect x="11" y="7" width="18" height="26" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="17" y="4.5" width="6" height="2.5" rx="1" fill="currentColor" />
      {made ? <path d="M13.5 22.5c2.2-2.4 3.8 1.2 6.2-1.3s3.9 1.1 6.3-1.2" fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" /> : <circle cx="20" cy="25" r="1.4" fill="currentColor" />}
    </svg>
  );
}
