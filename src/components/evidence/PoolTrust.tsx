import { POOL_WRITE_SCOPE } from "@/lib/api/keys";

/**
 * The shared hash pool's trust model, said the same way on /evidence#network and /developers: who may write to the
 * pool, who may read it, and what crosses between firms. Each line is what the code does
 * (src/app/api/v1/hash-pool/register/route.ts, src/lib/api/keys.ts, src/app/api/v1/hash-pool/_lib/pool.ts).
 */
export const POOL_TRUST: { k: string; v: string }[] = [
  {
    k: "Who may write",
    v: `Firms connected to Remedy, each with a key tied to its firm (scope ${POOL_WRITE_SCOPE}), issued when the firm connects. Claims a firm takes on Remedy add their photo's hash as they are checked. A self-serve sandbox key can check but not register, so the pool holds only photos a firm has handled.`,
  },
  { k: "Who may read", v: "Anyone, with or without a key: POST /api/v1/hash-pool/check answers whether a hash is within range of one already in the pool or a published recall picture." },
  { k: "What crosses", v: "Only the 64-bit hashes and an opaque ref. No photo, no name, no contact and no firm: the registering firm is kept in Remedy's own audit ledger, never in the pool row or an answer." },
];

export function PoolTrust({ className = "ev-trust" }: { className?: string }) {
  return (
    <dl className={className} aria-label="The shared hash pool's trust model">
      {POOL_TRUST.map((t) => (
        <div key={t.k}>
          <dt>{t.k}</dt>
          <dd>{t.v}</dd>
        </div>
      ))}
    </dl>
  );
}
