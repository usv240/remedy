import type { Metadata } from "next";
import Link from "next/link";
import { demoPicks } from "@/app/api/claims/_lib/recall";
import { LIVE_PRESET, listPresets, readRecorded, recordedSamples } from "@/app/api/try/_lib/presets";
import { Info } from "@/components/Info";
import { AnyRecall } from "@/components/try/AnyRecall";
import { Presets, type PresetCard } from "@/components/try/Presets";
import { TryTabs } from "@/components/try/TryTabs";
import { YourPhoto } from "@/components/try/YourPhoto";
import { SANDBOX_LABEL } from "@/lib/payments/deps";
import "../pages.css";
import "@/components/claim/claim.css";
import "@/components/try/try.css";

export const metadata: Metadata = { title: "Try a photo", description: "See a photo become a refund. Run Remedy's ready-made examples, your own photo, or any CPSC recall." };

export default function TryPage() {
  const { presets, user } = listPresets();
  const card = (p: (typeof presets)[number]): PresetCard => ({
    id: p.id,
    title: p.title,
    summary: p.summary,
    recall: p.recall,
    photo_alt: p.photo_alt,
    photo_credit: p.photo_credit,
    expected: p.expected,
    technical: p.technical && readRecorded(p.technical.recorded) ? { note: p.technical.note } : null,
    user: Boolean(p.user),
    live: p.id === LIVE_PRESET,
  });
  return (
    <div className="page frame tr-page">
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title tr-title">See a photo become a refund</h1>
          <Info id="page.try" />
        </div>
        <p className="lede">Start with one of our examples, then try your own photo or any recall. Brightline&rsquo;s sample charger can also run live.</p>
        <p className="tr-shop-line">
          Want the refund to go back to a PayPal purchase?{" "}
          <Link className="text-link" href="/try/shop">
            Buy the sample charger
          </Link>{" "}
          in the sandbox, then claim it.
        </p>
      </header>
      <TryTabs
        panels={{
          examples: <Presets madeSafe={presets.filter((p) => p.group === "made-safe").map(card)} recorded={recordedSamples()} others={presets.filter((p) => p.group !== "made-safe").map(card)} user={user.map(card)} />,
          "your-photo": <YourPhoto picks={demoPicks()} />,
          "any-recall": <AnyRecall />,
        }}
      />
      <p className="page-note">{SANDBOX_LABEL} Payouts on this page come from Brightline Home, a fictional sample firm, using its PayPal sandbox account.</p>
    </div>
  );
}
