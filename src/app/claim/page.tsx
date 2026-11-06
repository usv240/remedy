import type { Metadata } from "next";
import { demoPicks } from "@/app/api/claims/_lib/recall";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { FindRecall } from "@/components/claim/FindRecall";
import "@/components/claim/claim.css";

export const metadata: Metadata = {
  title: "Find your recall",
  description: "Find the recall for your product, make it safe, snap one photo, and get your refund through PayPal.",
};

export default function FindRecallPage() {
  const picks = demoPicks();
  return (
    <div className="cl-page frame">
      <header className="cl-head">
        <h1 className="cl-title">Find your recall</h1>
        <p className="cl-lede">Search for what the product is. Then make it safe, snap one photo, and get your refund.</p>
      </header>
      <section className="cl-find app-sheet" aria-labelledby="find-h">
        <h2 id="find-h" className="cl-step-title">
          Your product <ClaimInfo k="claim.recall" topic="recall numbers" />
        </h2>
        <FindRecall picks={picks} />
        <p className="cl-hint">Shown first: three recent recalls that refund for a photo of the product made safe.</p>
      </section>
    </div>
  );
}
