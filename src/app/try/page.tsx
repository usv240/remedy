import type { Metadata } from "next";
import Link from "next/link";
import { demoPicks } from "@/app/api/claims/_lib/recall";
import { LIVE_PRESET, listPresets, readRecorded, recordedSamples } from "@/app/api/try/_lib/presets";
import { AssistantRun } from "@/components/developers/McpSession";
import { Info } from "@/components/Info";
import { AnyRecall } from "@/components/try/AnyRecall";
import { checkTimeWords } from "@/components/evidence/errors";
import { Presets, type PresetCard } from "@/components/try/Presets";
import { TryTabs } from "@/components/try/TryTabs";
import { YourPhoto } from "@/components/try/YourPhoto";
import { TRY_PAYOUT } from "@/app/api/try/_lib/sandbox-payout";
import { readyPayee } from "@/lib/firm/sample-claims";
import { SANDBOX_LABEL } from "@/lib/payments/deps";
import { maskContact } from "@/lib/secure";
import "../pages.css";
import "../developers/dev.css";
import "../learn/disclosure.css";
import "@/components/claim/claim.css";
import "@/components/try/try.css";

export const metadata: Metadata = { title: "Try a photo", description: "See a photo become a refund. Run Remedy's ready-made examples, your own photo, or any CPSC recall." };

export default async function TryPage() {
  const { presets, user } = listPresets();
  // The sandbox personal account the one-click payout pays: the one TESTING.md publishes, shown masked.
  const buyer = await readyPayee().catch(() => null);
  const pay = { amount: `$${(TRY_PAYOUT.amountCents / 100).toFixed(2)}`, payee: buyer ? maskContact(buyer) : null };
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
    pay: p.id === TRY_PAYOUT.preset ? pay : null,
  });
  return (
    <div className="page frame tr-page">
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title tr-title">See a photo become a refund</h1>
          <Info id="page.try" />
        </div>
        <p className="lede">Start with one of our examples, then try your own photo or any recall. Brightline&rsquo;s sample charger can also run live, and send its refund as a real PayPal sandbox payout.</p>
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
          examples: <Presets madeSafe={presets.filter((p) => p.group === "made-safe").map(card)} recorded={recordedSamples()} others={presets.filter((p) => p.group !== "made-safe").map(card)} user={user.map(card)} timing={checkTimeWords().short} />,
          "your-photo": <YourPhoto picks={demoPicks()} />,
          "any-recall": <AnyRecall />,
        }}
      />
      <AssistantRun />
      <p className="page-note">{SANDBOX_LABEL} Payouts on this page come from Brightline Home, a fictional sample firm, using its PayPal sandbox account.</p>
    </div>
  );
}
