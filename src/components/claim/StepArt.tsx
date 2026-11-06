import type { StepKind } from "./steps";

/**
 * Small line drawings for each step, drawn in code in one stroke weight. They name the action, not a brand: a cord
 * with a gap and scissors, a garment in two pieces, a word written in marker, a phone framing the product.
 */
export function StepArt({ kind, word = "RECALLED", className }: { kind: StepKind; word?: string; className?: string }) {
  return (
    <svg className={className ?? "cl-art"} viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{ART[kind](word)}</g>
    </svg>
  );
}

const scissors = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <circle cx="-7" cy="10" r="4" />
    <circle cx="7" cy="10" r="4" />
    <path d="M-4.5 7 L6 -10 M4.5 7 L-6 -10" />
  </g>
);

const ART: Record<StepKind, (word: string) => React.ReactNode> = {
  stop: () => (
    <>
      <rect x="40" y="18" width="18" height="28" rx="4" />
      <path d="M46 28v6M52 28v6" />
      <path d="M8 32h10" />
      <rect x="18" y="25" width="10" height="14" rx="2" />
      <path d="M28 29h5M28 35h5" />
      <path d="M8 32c-3 0-4 4-4 8" className="cl-art-soft" />
    </>
  ),
  cut_cord: () => (
    <>
      <path d="M4 44h22M38 44h22" />
      <path d="M26 44l2-2M38 44l-2 2" className="cl-art-soft" />
      {scissors(32, 22)}
    </>
  ),
  cut_in_half: () => (
    <>
      <path d="M14 14l8-4h5c1 3 3 4 5 4v38H20V26l-6 2-4-9z" />
      <path d="M50 14l-8-4h-5c-1 3-3 4-5 4" transform="translate(4 0)" />
      <path d="M36 14v38h12V26l6 2 4-9-8-5" transform="translate(0 0)" />
      <path d="M34 8v48" strokeDasharray="2 3" className="cl-art-soft" />
    </>
  ),
  write: (word) => (
    <>
      <rect x="6" y="20" width="40" height="30" rx="5" />
      <text x="26" y="39" textAnchor="middle" fontSize={word.length > 8 ? 6.4 : 7.4} fontWeight="600" fill="currentColor" stroke="none" fontFamily="var(--font-ui)" transform="rotate(-6 26 37)">
        {word.slice(0, 11)}
      </text>
      <path d="M44 22l12-12 4 4-12 12-6 2z" />
      <path d="M52 14l4 4" className="cl-art-soft" />
    </>
  ),
  photo: () => (
    <>
      <rect x="18" y="6" width="28" height="52" rx="5" />
      <path d="M24 16h4M24 16v4M40 16h-4M40 16v4M24 44h4M24 44v-4M40 44h-4M40 44v-4" />
      <rect x="27" y="24" width="10" height="12" rx="2" className="cl-art-soft" />
      <path d="M29 52h6" />
    </>
  ),
  send: () => (
    <>
      <rect x="10" y="14" width="24" height="44" rx="5" />
      <path d="M17 50h10" />
      <path d="M22 38V26m-5 5l5-5 5 5" />
      <circle cx="47" cy="20" r="11" />
      <path d="M42 20l3.5 3.5L52 17" />
    </>
  ),
  dispose: () => (
    <>
      <path d="M14 20h36M26 20v-5h12v5" />
      <path d="M18 20l3 34h22l3-34" />
      <path d="M28 28v18M36 28v18" className="cl-art-soft" />
    </>
  ),
  remove: () => (
    <>
      <rect x="6" y="22" width="32" height="24" rx="4" />
      <rect x="44" y="28" width="14" height="12" rx="2" />
      <path d="M38 34h-4M44 34h-2" strokeDasharray="2 2" className="cl-art-soft" />
    </>
  ),
  other: () => (
    <>
      <path d="M6 46c10-6 18-6 26 0s16 6 26 0" className="cl-art-soft" />
      {scissors(32, 24)}
    </>
  ),
};
