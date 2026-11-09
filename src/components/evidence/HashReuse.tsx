import { fmtInt } from "@/lib/api/format";
import { catalogCounts } from "@/lib/verify/dhash";
import run from "../../../content/public/hash-reuse-run.json";
import "./hash-reuse.css";

/**
 * The hash pool against a reused photo (content/public/hash-reuse-run.json, recorded by scripts/public/hash-reuse-run.ts
 * with no model call): the photos in the repo with a known answer, each put through the changes a reuser makes, and how
 * many copies the two thresholds catch against the source photo, and how many land near a picture they are not a copy of.
 * Shown on /evidence#network under the two-firm run; tests/hash-reuse-run.test.ts derives the table again.
 */
export function HashReuse() {
  const r = run;
  const t = r.totals;
  const f = r.falseMatches;
  const same = r.thresholds.sameRecall;
  const other = r.thresholds.otherRecalls;
  const cat = catalogCounts();
  const distance = (k: { medianDistance: number; maxDistance: number }) => (k.medianDistance === k.maxDistance ? `${k.medianDistance}` : `${k.medianDistance}, up to ${k.maxDistance}`);
  const p = r.phash;
  const second = (kind: string) => p.byKind.find((k) => k.kind === kind);
  return (
    <div className="ev-reuse">
      <h3 className="ev-sub">The same hash against a reused photo</h3>
      <p className="page-prose tabular">
        The {fmtInt(r.sources.length)} photos in the repo with a known answer, each put through {r.variants.length} changes a reuser makes, give {fmtInt(t.n)} copies. With both hashes at the thresholds in use, {fmtInt(p.inUse.either.caught)} of {fmtInt(t.n)} are caught across firms, with {p.inUse.either.unrelated} unrelated matches. The difference hash alone, against the source photo&rsquo;s stored hash, catches{" "}
        {fmtInt(t.caught4)} of {fmtInt(t.n)} at {other} bits (every other recall and firm) and {fmtInt(t.caught10)} at {same} bits (the same recall&rsquo;s earlier claims). Against the {fmtInt(f.unrelatedRefs.catalog)} published pictures of other recalls and the other {f.unrelatedRefs.sources} photos, none of
        the {fmtInt(f.of)} copies comes within {other} bits of a picture it is not a copy of ({f.within4} of {fmtInt(f.of)}); {f.within10} come within {same}, which is why that wider threshold is used only within one recall. The nearest unrelated picture is {f.nearestUnrelatedMin} bits away.
      </p>
      <h3 className="ev-sub">A second hash for crops and turns</h3>
      <p className="page-prose tabular">
        Beside the dHash, every claim photo gets a second 64-bit hash of its center ({Math.round(p.region * 100)} percent of each side, the lowest frequencies of a DCT), compared in {p.framings.length} framings: as stored, a little wider for a crop, turned back a few degrees, and
        mirrored. On the same {fmtInt(t.n)} copies it catches {fmtInt(p.inUse.phash.caught)} at {p.inUse.phashBits} bits, and either hash catches {fmtInt(p.inUse.either.caught)} of {fmtInt(t.n)} at the thresholds in use ({p.inUse.dhashBits} bits for the dHash across firms,{" "}
        {p.inUse.phashBits} for the second), with {p.inUse.either.unrelated} unrelated matches against the same {fmtInt(p.catalogPictures)} published pictures and {f.unrelatedRefs.sources} photos. Its threshold is set from this run: its nearest unrelated picture is {p.nearestUnrelatedMin} bits away, so {p.inUse.phashBits} bits keeps a margin of
        {p.nearestUnrelatedMin - p.inUse.phashBits}, and a wider threshold would start to hold photos nobody had sent before. The second hash is matched against earlier claim photos and registered pool hashes, where a photo is reused; published
        pictures stay on the dHash.
      </p>
      <div className="jb-wrap ev-reuse-table" data-ui role="region" aria-label="Copies caught and unrelated matches, by threshold and hash" tabIndex={0}>
        <table className="jb">
          <caption className="sr-only">At each threshold, the copies each hash catches and the copies that come within it of a picture they are not a copy of</caption>
          <thead>
            <tr>
              <th scope="col">Threshold</th>
              <th scope="col" className="jb-num">
                dHash alone
              </th>
              <th scope="col" className="jb-num">
                Second hash alone
              </th>
              <th scope="col" className="jb-num">
                Either
              </th>
            </tr>
          </thead>
          <tbody>
            {p.byThreshold.map((b) => (
              <tr key={b.bits}>
                <th scope="row" className="tabular">
                  {b.bits} bits
                </th>
                {[b.dhash, b.phash, b.either].map((c, i) => (
                  <td key={i} className="jb-num tabular">
                    {c.caught} caught, {c.unrelated} unrelated
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="ev-reuse-list" data-ui aria-label="Copies caught and unrelated matches, by threshold and hash">
        {p.byThreshold.map((b) => (
          <li key={b.bits} className="ev-reuse-item">
            <p className="ev-reuse-item-head">
              <span className="ev-reuse-kind tabular">{b.bits} bits</span>
            </p>
            <p className="tabular">
              dHash {b.dhash.caught} caught, {b.dhash.unrelated} unrelated; second hash {b.phash.caught}, {b.phash.unrelated}; either {b.either.caught}, {b.either.unrelated}
            </p>
          </li>
        ))}
      </ul>
      <div className="jb-wrap ev-reuse-table" data-ui role="region" aria-label="Copies caught, by the change made" tabIndex={0}>
        <table className="jb">
          <caption className="sr-only">Each change a reuser makes, how many of the copies the two thresholds catch, and how far the copies sit from the source</caption>
          <thead>
            <tr>
              <th scope="col">The change</th>
              <th scope="col" className="jb-num">
                Caught at {same} bits
              </th>
              <th scope="col" className="jb-num">
                Caught at {other} bits
              </th>
              <th scope="col" className="jb-num">
                Second hash at {p.inUse.phashBits} bits
              </th>
              <th scope="col" className="jb-num">
                Bits from the source
              </th>
            </tr>
          </thead>
          <tbody>
            {r.byKind.map((k) => (
              <tr key={k.kind}>
                <th scope="row">
                  <span className="ev-reuse-kind">{k.label}</span>
                  <span className="ev-reuse-params">{k.parameters}</span>
                </th>
                <td className="jb-num tabular">
                  {k.caught10} of {k.n}
                </td>
                <td className="jb-num tabular">
                  {k.caught4} of {k.n}
                </td>
                <td className="jb-num tabular">
                  {second(k.kind)?.phash ?? 0} of {k.n}
                </td>
                <td className="jb-num tabular">{distance(k)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The same rows as a list on a phone, where four columns would only scroll sideways. One of the two shows. */}
      <ul className="ev-reuse-list" data-ui aria-label="Copies caught, by the change made">
        {r.byKind.map((k) => (
          <li key={k.kind} className="ev-reuse-item">
            <p className="ev-reuse-item-head">
              <span className="ev-reuse-kind">{k.label}</span>
              <span className="ev-reuse-params">{k.parameters}</span>
            </p>
            <p className="tabular">
              {k.caught10} of {k.n} at {same} bits, {k.caught4} of {k.n} at {other}, {second(k.kind)?.phash ?? 0} of {k.n} by the second hash; {distance(k)} bits from the source
            </p>
          </li>
        ))}
      </ul>
      <p className="page-prose ev-reuse-after">
        <strong>A copy the hash misses is not paid on that alone.</strong> The hash is one part of one check of six. A cropped or turned copy still meets the rest of the own-photo check, where the model looks for the signs of a screen, a print
        or a downloaded picture, and the other five checks; when a check is unsure, the two reviewers read it, and the Product reviewer is asked whether it is a camera photo of a real object. Every published picture of a recall is in the pool
        for claims on that recall, and the {fmtInt(cat.catalog)} distinct enough to tell their recall apart (of {fmtInt(cat.stored)} stored) for claims on every other recall.
      </p>
      <p className="page-note">
        Measured in code, with no model call: scripts/public/hash-reuse-run.ts hashes each copy the way a claim photo is hashed (src/lib/verify/dhash.ts and src/lib/verify/phash.ts; the published pictures&rsquo; second hashes come from their committed thumbnails, content/recalls/image-phashes.json) and writes content/public/hash-reuse-run.json with every distance; tests/hash-reuse-run.test.ts makes the copies
        again and checks the counts. It measures these {fmtInt(r.sources.length)} photos and these {r.variants.length} changes. Photos: the sample charger (Dmitry G, Wikimedia Commons, public domain), three Wikimedia Commons photos (credits in content/verify/fixtures/credits.json) and the
        CPSC&rsquo;s own made-safe examples for recalls 26125 and 25007.
      </p>
    </div>
  );
}
