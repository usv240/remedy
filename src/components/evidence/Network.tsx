import { RecallLabel } from "@/lib/recall/label";
import run from "../../../content/public/network-run.json";

/**
 * The first idea, running: one photo, two firms (content/public/network-run.json, recorded by
 * scripts/public/record-network-run.ts with no model call). A photo claimed at Brightline Home is sent for Fernway
 * Home's recall and held for a person, because its 64-bit hash matches Brightline's claim; only the hash and a row id
 * cross. Both firms are fictional samples.
 */
export function Network() {
  const r = run;
  const fields = r.crossed.fields.map((f) => (f === "dhash" ? "the 64-bit hash" : f === "ref" ? "a row id that opens nothing at the other firm" : f)).join(" and ");
  return (
    <>
      <p className="page-prose jp-intro">
        Every claim photo is checked against every photo already claimed, at any firm, by its hashes alone. Here is that check across two firms, recorded with no model call. Both firms and their recalls are fictional samples.
      </p>
      <ol className="ev-net" aria-label="One photo, two firms">
        <li className="ev-net-step">
          <p className="ev-net-k">
            1. At {r.first.firm} <span className="muted">{RecallLabel(r.first.recall)}</span>
          </p>
          <img className="ev-net-photo" src="/landing/charger-cord-cut.webp" alt="The sample charger's cord, cut where it met the case, with the bare wires showing." width={360} height={270} loading="lazy" />
          <p>The photo of the cut cord is verified and paid. The claim keeps one row for later checks: the photo&rsquo;s hash.</p>
          <p className="ev-net-hash">
            <code>{r.first.pool_row.dhash}</code>
          </p>
        </li>
        <li className="ev-net-step">
          <p className="ev-net-k">2. What crosses between firms</p>
          <p>Only {fields}. No photo, claimant, amount or recall reaches {r.second.firm}.</p>
          <p className="ev-net-hash">
            <code>{`{ ${r.crossed.fields.join(", ")} }`}</code>
          </p>
        </li>
        <li className="ev-net-step">
          <p className="ev-net-k">
            3. At {r.second.firm} <span className="muted">{RecallLabel(r.second.recall)}</span>
          </p>
          <p>
            The same photo is <strong>held for a person</strong> before any model call, in <span className="tabular">{r.second.timings.total_ms} ms</span>: &ldquo;{r.second.c3.plain}&rdquo;
          </p>
          <p className="muted">With {r.first.firm}&rsquo;s hash left out of the pool, the same photo goes on to the model step, so the hold comes from the shared hash.</p>
        </li>
      </ol>
      <p className="page-note">
        Recorded by scripts/public/record-network-run.ts into content/public/network-run.json, through the verifier a claim uses (src/lib/verify) with the pool the claim route reads from image_hash; tests/network-run.test.ts runs it again. Photo: Dmitry G,
        Wikimedia Commons, public domain.
      </p>
    </>
  );
}
