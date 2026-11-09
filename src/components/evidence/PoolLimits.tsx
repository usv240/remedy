import { fmtInt } from "@/lib/api/format";
import { HASH_LINEAGE } from "@/lib/research";
import run from "../../../content/public/hash-reuse-run.json";

/**
 * The pool's measured limits, said up front beside the two-firm run, and where a shared hash list comes from. Every
 * figure is read from content/public/hash-reuse-run.json (scripts/public/hash-reuse-run.ts); the lineage from
 * HASH_LINEAGE in src/lib/research.ts. The full table follows below it (HashReuse).
 */
export function poolLimits() {
  const t = run.totals;
  const f = run.falseMatches;
  const { otherRecalls: across, sameRecall: within } = run.thresholds;
  const p = run.phash.inUse;
  // The changes that get past both hashes at the thresholds in use, in the run's own words.
  const past = run.phash.byKind.filter((k) => k.either < k.n).map((k) => run.byKind.find((b) => b.kind === k.kind)?.label.toLowerCase() ?? k.kind);
  const pastWords = past.length === 0 ? "no change gets past both" : `only ${past.length === 1 ? "the" : ""} ${past.join(" and ")} copies get past both`.replace(/\s+/g, " ");
  return {
    sentence: `Measured on ${fmtInt(t.n)} reused copies of ${run.sources.length} photos: ${t.caught4} of ${t.n} caught at the ${across}-bit threshold used across firms, ${t.caught10} at ${within} bits, and ${f.within4} unrelated matches within ${across} bits.`,
    /** The second hash beside the dHash, at the thresholds in use (src/lib/verify/phash.ts, PHASH_MAX_DISTANCE). */
    second: `With the second hash beside it, at ${p.phashBits} bits, ${p.either.caught} of ${t.n} are caught across firms, with ${p.either.unrelated} unrelated matches; ${pastWords}.`,
    caught4: t.caught4,
    caught10: t.caught10,
    n: t.n,
    falseWithin4: f.within4,
    either: p.either.caught,
    eitherUnrelated: p.either.unrelated,
  };
}

export function PoolLimits() {
  const p = poolLimits();
  const L = HASH_LINEAGE;
  return (
    <div className="ev-limits">
      <p className="page-prose tabular">
        <strong>What the pool catches, measured.</strong> {p.sentence} {p.second} A copy that gets past the hashes is still read by the vision check and the other five checks.
      </p>
      <p className="page-prose">
        <strong>Where the idea comes from.</strong>{" "}
        <a className="text-link" href={L.photoDna.url} target="_blank" rel="noreferrer">
          {L.photoDna.name}
        </a>{" "}
        {L.photoDna.says}.{" "}
        <a className="text-link" href={L.stopNcii.url} target="_blank" rel="noreferrer">
          {L.stopNcii.name}
        </a>{" "}
        {L.stopNcii.says}. {L.differs}.
      </p>
    </div>
  );
}
