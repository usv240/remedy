import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import stats from "../../../content/recalls/stats.json";
import { Info } from "@/components/Info";
import { fmtDate, fmtInt, fmtUnits, shortTitle } from "@/lib/api/format";
import { explore } from "@/lib/api/explore";
import { HEADLINE } from "@/lib/recall/headline";
import { facets, filtersFrom, type ApiHit } from "@/lib/api/recall-data";
import { ruleChips } from "@/lib/api/rule-chips";
import { Filters } from "./_parts/Filters";
import { hrefFor, type FilterValues } from "./_parts/href";
import "../pages.css";
import "../landing-shared.css";
import "./recalls.css";

export const metadata: Metadata = { title: "Recalls", description: "Every US consumer product recall since January 2024 from the CPSC, searchable in plain words, with the ones that offer a refund for a photo marked." };

const PAGE = 20;

/**
 * The recall explorer (plan 5.2): every recall since 2024, Elastic hybrid search, filters, and each recall's proof rule
 * in short. A table on wide screens and cards on phones, 20 at first with Show more. A plain semantic table rather than
 * AG Grid: a read-only list of links needs no grid, and it renders on the server for every reader.
 */
export default function RecallsPage(props: PageProps<"/recalls">) {
  const C = stats.current;
  return (
    <div className="page frame recalls">
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">Recalls</h1>
          <Info id="page.recalls" />
        </div>
        <p className="lede">Find your recall, see what it asks you to do, and start a claim.</p>
        <p className="page-prose rx-intro">
          All <span className="tabular">{fmtInt(C.recalls.count)}</span> US consumer product recalls from {fmtDate(C.range.from)} to {fmtDate(C.range.to)}, from the U.S. Consumer Product Safety Commission.{" "}
          <span className="tabular">{fmtInt(HEADLINE.count)}</span> of them refund an owner for a photo of the product made safe.
        </p>
      </header>
      <Suspense fallback={<p className="page-loading rx-loading">Loading recalls…</p>}>
        <Explorer searchParams={props.searchParams} />
      </Suspense>
      <p className="page-note">Recall data and images: U.S. Consumer Product Safety Commission. Proof rules: Claude Opus 5.5, read from each official remedy.</p>
    </div>
  );
}

async function Explorer({ searchParams }: { searchParams: PageProps<"/recalls">["searchParams"] }) {
  const sp = await searchParams;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") p.set(k, v);
  const { query, filters } = filtersFrom(p);
  const show = Math.max(PAGE, Number(p.get("show")) || PAGE);
  const values: FilterValues = {
    query,
    photo_refund: filters.photoRefund === undefined ? "" : String(filters.photoRefund),
    year: String(filters.year ?? ""),
    category: filters.category ?? "",
    remedy: filters.remedy ?? "",
    units: filters.units ?? "",
  };
  const f = facets();
  const r = await explore({ query, filters, show });
  const cards: { label: string; value: string; count: number }[] = [
    { label: query ? "All matches" : "All recalls", value: "", count: r.counts.all },
    { label: "Photo refund", value: "true", count: r.counts.photo },
    { label: "Other remedies", value: "false", count: r.counts.other },
  ];
  const more = r.total > r.hits.length;

  return (
    <div className="rx app-sheet" data-ui>
      <Filters
        values={values}
        choices={{
          years: f.years,
          categories: f.categories,
          remedies: f.remedies,
          units: f.units,
        }}
      />
      <div className="rx-cards" role="group" aria-label="Show">
        {cards.map((c) => {
          const on = values.photo_refund === c.value;
          return (
            <Link key={c.label} className="rx-card" href={hrefFor("/recalls", { ...values, photo_refund: c.value })} aria-current={on ? "true" : undefined} scroll={false}>
              <span className="rx-card-k">{c.label}</span>
              <span className="rx-card-v tabular">{fmtInt(c.count)}</span>
            </Link>
          );
        })}
        <span className="rx-info">
          <Info id="recalls.filters" label="" topic="Filters" />
        </span>
      </div>

      <p className="rx-count" aria-live="polite">
        {r.total === 0 ? (
          <>No recall fits {query ? <>&ldquo;{query}&rdquo; with </> : ""}these filters. Try fewer filters, or other words for the product.</>
        ) : (
          <>
            Showing <span className="tabular">{fmtInt(r.hits.length)}</span> of <span className="tabular">{fmtInt(r.total)}</span>
            {query ? <> for &ldquo;{query}&rdquo;, closest first</> : ", newest first"}.
            {r.mode === "elastic" && <span className="rx-mode lp-tech"> Elastic hybrid search, reranked by {r.reranker ?? "rank fusion"}.</span>}
            {r.mode === "local" && <span className="rx-mode lp-tech"> In-app keyword ranking (Elastic is not connected).</span>}
          </>
        )}
      </p>

      {r.hits.length > 0 && (
        <>
          <div className="rx-table-wrap" role="region" aria-label="Recalls" tabIndex={0}>
            <table className="rx-table">
              <thead>
                <tr>
                  <th scope="col" className="rx-col-img">
                    <span className="sr-only">Picture</span>
                  </th>
                  <th scope="col">Recall</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="rx-num">
                    Units
                  </th>
                  <th scope="col">What it asks</th>
                </tr>
              </thead>
              <tbody>
                {r.hits.map((h) => (
                  <Row key={h.number} h={h} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="rx-list">
            {r.hits.map((h) => (
              <Card key={h.number} h={h} />
            ))}
          </ul>
        </>
      )}

      {more && (
        <p className="rx-more">
          <Link className="btn btn-quiet" href={hrefFor("/recalls", { ...values, show: show + PAGE })} scroll={false}>
            Show {Math.min(PAGE, r.total - r.hits.length)} more
          </Link>
        </p>
      )}
    </div>
  );
}

function Asks({ h }: { h: ApiHit }) {
  if (!h.photo_refund) return <span className="chip" data-quiet="">{h.remedies.join(", ") || "See the recall"}</span>;
  return (
    <>
      {ruleChips(h.proof_rule).map((c) => (
        <span key={c} className="chip">
          {c}
        </span>
      ))}
    </>
  );
}

function Row({ h }: { h: ApiHit }) {
  return (
    <tr>
      <td className="rx-col-img">{h.image?.thumb ? <img src={h.image.thumb} alt="" width={48} height={48} loading="lazy" /> : <span className="rx-noimg" />}</td>
      <td className="rx-title">
        <Link href={h.page} className="rx-link">
          {shortTitle(h.title)}
        </Link>
        <span className="rx-meta tabular">
          Recall {h.number} · {h.category}
        </span>
      </td>
      <td className="rx-date tabular">{fmtDate(h.date)}</td>
      <td className="rx-num tabular">{h.units === null ? "Not given" : fmtInt(h.units)}</td>
      <td className="rx-asks">
        <Asks h={h} />
      </td>
    </tr>
  );
}

function Card({ h }: { h: ApiHit }) {
  return (
    <li>
      <Link href={h.page} className="rx-mcard">
        <span className="rx-mthumb" aria-hidden="true">
          {h.image?.thumb ? <img src={h.image.thumb} alt="" width={64} height={64} loading="lazy" /> : null}
        </span>
        <span className="rx-mbody">
          <span className="rx-mtitle">{shortTitle(h.title)}</span>
          <span className="rx-meta tabular">
            Recall {h.number} · {fmtDate(h.date)} · {fmtUnits(h.units)}
          </span>
          <span className="rx-chips">
            <Asks h={h} />
          </span>
        </span>
      </Link>
    </li>
  );
}
