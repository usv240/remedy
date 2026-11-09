/**
 * Choose the real CPSC recalls behind the /try presets and write content/recalls/demo-picks.json.
 *
 *   npx tsx scripts/recalls/demo-picks.ts
 *
 * Each pick is checked against its criteria from the data (remedy words, proof rule, official images), and the other
 * recalls that meet the same criteria are listed as alternates.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProofRule } from "../../src/lib/recall/proof-rule";
import type { Recall, RecallsFile } from "../../src/lib/recall/types";

const dir = path.join(process.cwd(), "content", "recalls");
const recalls = (JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as RecallsFile).recalls;
const rules = (JSON.parse(readFileSync(path.join(dir, "proof-rules.json"), "utf8")) as { rules: Record<string, ProofRule> }).rules;
const images = JSON.parse(readFileSync(path.join(dir, "image-hashes.json"), "utf8")) as Record<string, { url: string; dhash: string; caption: string; thumb: string | null; width: number; height: number }[]>;

type Pick = { id: string; presets: string[]; number: string; criteria: (r: Recall) => boolean; why: string };
const text = (r: Recall) => `${r.title} ${r.products.map((p) => p.name).join(" ")}`;
const PICKS: Pick[] = [
  {
    id: "power-bank-marked",
    presets: ["power-bank-marked", "not-yet-safe", "look-alike"],
    number: "27056",
    criteria: (r) => r.date.startsWith("2026") && /power bank/i.test(text(r)) && r.photoRefund && /recalled/i.test(rules[r.number]?.marker_text ?? "") && rules[r.number]?.actions.includes("write_recalled"),
    why: "A 2026 power bank recall (Oct 29, 2026) whose remedy pays a full refund for a photo of the power bank with the word \"recalled\" written on it in permanent marker. The photo needs only the marked product, so a retake for a missing marking is easy to show. Three official images of model W5 PRO (front and side).",
  },
  {
    id: "cord-cut",
    presets: ["cord-cut", "official-image"],
    number: "26754",
    criteria: (r) => r.photoRefund && rules[r.number]?.actions.includes("cut_cord") && (images[r.number]?.length ?? 0) >= 3,
    why: "The remedy asks the owner to cut the power cord and email a photo of the destroyed product for a full refund. A hair dryer brush is a small appliance that is easy to photograph with its cord cut. Five official images, including the packaging label with the model number, which also gives the official-image preset a clear picture to test the own-photo check.",
  },
  {
    id: "pajamas-cut",
    presets: ["pajamas-cut"],
    number: "27045",
    criteria: (r) => r.date === "2026-10-29" && /pajama/i.test(text(r)) && r.photoRefund && rules[r.number]?.actions.includes("cut_in_half"),
    why: "The Oct 29, 2026 children's pajama set recall: the remedy asks owners to cut the pajamas in half and email a photo of the destroyed set to receive the refund. It is the remedy quoted in research/validation_recalls.md. Three official images.",
  },
];

const out = PICKS.map((p) => {
  const r = recalls.find((x) => x.number === p.number);
  if (!r) throw new Error(`Recall ${p.number} is not in recalls.json`);
  if (!p.criteria(r)) throw new Error(`Recall ${p.number} no longer meets the ${p.id} criteria`);
  const imgs = images[r.number] ?? [];
  const best = [...imgs].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const alternates = recalls
    .filter((x) => x.number !== r.number && p.criteria(x))
    .sort((a, b) => (images[b.number]?.length ?? 0) - (images[a.number]?.length ?? 0) || (a.date < b.date ? 1 : -1))
    .slice(0, 4)
    .map((x) => ({ number: x.number, date: x.date, title: x.title, images: images[x.number]?.length ?? 0, url: x.url }));
  return {
    id: p.id,
    presets: p.presets,
    number: r.number,
    title: r.title,
    date: r.date,
    units: r.units,
    firm: r.manufacturers[0] ?? null,
    remedyText: r.remedyText,
    consumerContact: r.consumerContact,
    recallUrl: r.url,
    imageUrl: best?.url ?? r.images[0]?.url ?? null,
    imageThumb: best?.thumb ?? null,
    imageCaption: best?.caption ?? r.images[0]?.caption ?? null,
    images: imgs.map(({ url, thumb, caption, dhash }) => ({ url, thumb, caption, dhash })),
    proofRule: rules[r.number] ?? null,
    why: p.why,
    alternates,
  };
});

writeFileSync(
  path.join(dir, "demo-picks.json"),
  JSON.stringify(
    {
      chosenAt: new Date().toISOString(),
      note: "Real CPSC recalls with their real data. Images: US Consumer Product Safety Commission (cpsc.gov), public domain. Any demo payout is a demonstration in PayPal sandbox; Remedy is not affiliated with the recalling firm.",
      picks: out,
    },
    null,
    1,
  ),
);
for (const p of out) console.log(`${p.id}: ${p.number} ${p.title.slice(0, 80)} (${p.images.length} images, ${p.alternates.length} alternates)`);
