import type { Metadata } from "next";
import { FirmInfo } from "@/components/firm/FirmInfo";
import { ScanCatalog } from "@/components/firm/ScanCatalog";
import { SCAN_LIMITS } from "@/lib/recall/scan";

export const metadata: Metadata = { title: "Scan a catalog", description: "Paste or upload the products you sell and see which ones a recall covers, which pay a refund for a photo, and the claim link for each. A fictional sample firm." };

export default function ScanPage() {
  return (
    <>
      <header className="firm-head">
        <div>
          <div className="title-row">
            <h1 className="firm-title">Scan a catalog</h1>
            <FirmInfo id="firm.scan" />
          </div>
          <p className="firm-sub">Paste or upload the products you sell. Each row comes back as a photo-refund recall, another recall, clear, or unknown, with the claim link.</p>
        </div>
      </header>
      <ScanCatalog freeItems={SCAN_LIMITS.freeItems} maxItems={SCAN_LIMITS.maxItems} />
      <p className="firm-label">Recall data: US Consumer Product Safety Commission, public domain. A stated model or UPC in a recall&rsquo;s own list settles a row without AI; Claude reads only the rows in between. Demonstration in PayPal sandbox. Remedy is not affiliated with the recalling firm.</p>
    </>
  );
}
