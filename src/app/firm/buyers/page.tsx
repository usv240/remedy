import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { BuyersImport } from "@/components/firm/BuyersImport";
import { FirmInfo } from "@/components/firm/FirmInfo";
import { dbConfigured } from "@/lib/db";
import { knownSales } from "@/lib/firm/buyers-data";
import { dayName, isoDay } from "@/lib/firm/dates";
import { firmContext } from "@/lib/firm/firm";
import { fmtUsd } from "@/lib/firm/report";
import { recallLabel } from "@/lib/recall/label";

export const metadata: Metadata = { title: "Buyers", description: "Find the people who bought a recalled product, from a sales file or PayPal, and download a notice with a personal claim link for each. A fictional sample firm." };

const SOURCE: Record<string, string> = { shop: "Sample shop", paypal: "PayPal search", csv: "Sales file" };

async function Buyers() {
  await connection();
  const ctx = dbConfigured() ? await firmContext().catch(() => null) : null;
  if (!ctx?.main) return <p className="firm-sub">The sample firm is not set up on this server yet.</p>;
  const sales = await knownSales(ctx.firm, ctx.main);
  return (
    <>
      <p className="firm-sub" style={{ marginTop: 8 }}>
        For {ctx.main.short}, {recallLabel(ctx.main.number)}.
      </p>
      <BuyersImport recall={ctx.main.number} product={ctx.main.short} today={isoDay(new Date())} firmName={ctx.firm.name.replace(/\s*\(sample\)\s*$/i, "")} />
      <section className="firm-section" aria-labelledby="by-known">
        <h2 id="by-known">Buyers already in Remedy ({sales.length})</h2>
        {sales.length === 0 ? (
          <p className="muted">None yet. A purchase in the sample shop, a sales file or a PayPal search adds them here.</p>
        ) : (
          <div className="by-table-wrap" role="region" aria-labelledby="by-known" tabIndex={0}>
            <table className="by-table">
              <thead>
                <tr>
                  <th scope="col">Buyer</th>
                  <th scope="col">Item</th>
                  <th scope="col">From</th>
                  <th scope="col">Paid</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 100).map((s) => (
                  <tr key={s.saleId}>
                    <td>{s.contact}</td>
                    <td>{s.item}</td>
                    <td>
                      {SOURCE[s.source] ?? s.source}
                      {s.sample ? <span className="muted"> (sample)</span> : null}
                    </td>
                    <td className="tabular">{s.paidAt ? dayName(s.paidAt) : "None"}</td>
                    <td className="num">{fmtUsd(s.amountCents)}</td>
                    <td>
                      {s.claimed ? "Claimed" : s.notified ? "Notified" : "Not notified yet"}
                      {s.refundToOriginal ? (
                        <>
                          {" "}
                          <span className="pill" data-tone="info">
                            Refund to original payment after photo
                          </span>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sales.some((s) => s.sample) && (
          <p className="muted" style={{ marginTop: 10, maxWidth: "72ch" }}>
            The rows marked sample are a labelled sample of a PayPal Transaction Search answer for this recall, built from the sandbox test buyer&rsquo;s purchases of the sample charger and matched by the same search code a firm&rsquo;s own PayPal search runs. No PayPal call was made for them, and they carry no payment to refund.
          </p>
        )}
      </section>
    </>
  );
}

export default function BuyersPage() {
  return (
    <>
      <header className="firm-head">
        <div>
          <div className="title-row">
            <h1 className="firm-title">Buyers</h1>
            <FirmInfo id="firm.buyers" />
          </div>
          <p className="firm-sub">Find the people who bought the recalled product, and download a notice for each, with a personal claim link, to send from your own mail tool.</p>
        </div>
      </header>
      <Suspense fallback={<p className="firm-sub page-loading">Loading the buyers&hellip;</p>}>
        <Buyers />
      </Suspense>
      <p className="firm-label">Sales files stay private: contacts are stored encrypted and shown masked, and the download takes each address from your own file, in your browser. Remedy sends no mail; you send the notices from your mail tool.</p>
    </>
  );
}
