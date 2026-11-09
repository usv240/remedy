import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/Info";
import { OpenOnHash } from "@/components/OpenOnHash";
import { Lineage } from "@/components/evidence/Lineage";
import { PhotoChecks } from "@/components/evidence/PhotoChecks";
import { RefPictures } from "@/components/evidence/RefPictures";
import { ReviewerModels } from "@/components/evidence/ReviewerModels";
import { reviewerModels } from "@/components/evidence/reviewer-models";
import { Reviewers } from "@/components/evidence/Reviewers";
import { Reading, Settings } from "@/components/evidence/Settings";
import "../../pages.css";
import "../../landing-shared.css";
import "../evidence.css";

export const metadata: Metadata = { title: "Photo checks", description: "Every recorded photo check with its six results, the sample recall's reference pictures, the model settings compared with every revised answer, and what the model read on the CPSC's own photos." };

/** /evidence/photo-checks: the long tables behind the photo-check figures on /evidence. */
export default function PhotoChecksPage() {
  return (
    <div className="page frame evidence">
      <OpenOnHash />
      <header className="page-head">
        <p className="ev-back">
          <Link className="text-link" href="/evidence#photo-checks">
            Evidence
          </Link>
        </p>
        <div className="title-row">
          <h1 className="page-title">Photo checks</h1>
          <Info id="evidence.fixtures" />
        </div>
        <p className="lede">Each case is a real recall photo or a copy made from one. The checks keep the refund pool for real owners: a picture that is not the owner&rsquo;s own is asked to be retaken, kindly.</p>
      </header>

      <section id="runs" className="page-section" aria-labelledby="runs-h">
        <h2 id="runs-h">The recorded runs</h2>
        <PhotoChecks />
      </section>

      <section id="reviewers" className="page-section" aria-labelledby="reviewers-h">
        <h2 id="reviewers-h">One reviewer against the referee</h2>
        <Reviewers />
      </section>

      <section id="references" className="page-section" aria-labelledby="references-h">
        <h2 id="references-h">The sample recall&rsquo;s reference pictures</h2>
        <RefPictures />
      </section>

      <section id="reading" className="page-section" aria-labelledby="reading-h">
        <h2 id="reading-h">What the model read on the CPSC&rsquo;s own photos</h2>
        <Reading />
      </section>

      <section id="lineage" className="page-section" aria-labelledby="lineage-h">
        <div className="title-row">
          <h2 id="lineage-h">Where the two-reviewer design comes from</h2>
          <Info id="evidence.lineage" label="" topic="The two-reviewer design" />
        </div>
        <Lineage />
      </section>

      {reviewerModels() ? (
        <section id="reviewer-models" className="page-section" aria-labelledby="reviewer-models-h">
          <div className="title-row">
            <h2 id="reviewer-models-h">The two reviewers on one model and on two</h2>
            <Info id="evidence.models" label="" topic="The two reviewers on one model and on two" />
          </div>
          <ReviewerModels />
        </section>
      ) : null}

      <section id="settings" className="page-section" aria-labelledby="settings-h">
        <h2 id="settings-h">Which model setting checks the photo, and why</h2>
        <Settings />
        <p className="page-note">Scored by src/components/evidence/errors.ts from content/verify/sweep-results.json, three trials of eight photos per setting, against the known answers in content/verify/fixtures/cases.json.</p>
      </section>
    </div>
  );
}
