import type { Metadata } from "next";
import { demoPicks } from "@/app/api/claims/_lib/recall";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { FindRecall } from "@/components/claim/FindRecall";
import { LabelInfo, LabelScan } from "@/components/claim/LabelScan";
import "@/components/claim/claim.css";
import "@/components/claim/label.css";

export const metadata: Metadata = {
  title: "Find your recall",
  description: "Find the recall for your product by name or from a photo of its label, make it safe, snap one photo, and get your refund through PayPal.",
};

export default function FindRecallPage() {
  const picks = demoPicks();
  return (
    <div className="cl-page frame">
      <header className="cl-head">
        <h1 className="cl-title">Find your recall</h1>
        <p className="cl-lede">Search for what the product is, or snap its label. Then make it safe, snap one photo, and get your refund.</p>
      </header>
      <div className="cl-ways">
        <section id="find" className="cl-find app-sheet" aria-labelledby="find-h">
          <h2 id="find-h" className="cl-step-title">
            Your product <ClaimInfo k="claim.recall" topic="recall numbers" />
          </h2>
          <FindRecall picks={picks} />
          <p className="cl-hint">Shown first: three recent recalls that refund for a photo of the product made safe.</p>
        </section>
        <section id="snap" className="cl-find cl-snap app-sheet" aria-labelledby="snap-h">
          <h2 id="snap-h" className="cl-step-title">
            Is it recalled? Snap the label <LabelInfo />
          </h2>
          <LabelScan />
        </section>
      </div>
    </div>
  );
}
