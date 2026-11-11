/**
 * Input tokens per claim for the vision call, before and after the image-size change, on every
 * fixture photo plus a 12 MP phone-sized photo.
 *
 *   npx tsx --env-file=.env.local scripts/verify/tokens.ts
 *
 * Before: claim photo at a 1,568 px long edge, up to three official images at 768 px.
 * After:  claim photo at 1,280 px (1,568 px when the rule asks for a model, lot or date code), two official images.
 * Uses the free count_tokens endpoint when the account accepts it; otherwise counts image tokens exactly with the
 * documented formula, ceil(w / 28) x ceil(h / 28), and estimates text at 3.5 characters a token (marked "est").
 * Makes no paid call. Writes content/verify/tokens.json.
 */
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { fixtureFile, FIXTURES_DIR, loadFixtureCases, loadFixtureRecalls } from "../../src/lib/verify/fixtures";
import { claimMaxSide, decodeImage, LABEL_MAX_SIDE, visualTokens } from "../../src/lib/verify/image";
import { loadOfficialImages, pickForVision, type OfficialImage } from "../../src/lib/verify/official";
import { visionParams, VISION_SYSTEM } from "../../src/lib/verify/vision";
import { VisionReportSchema } from "../../src/lib/verify/vision-schema";
import type { VerifyProofRule, VerifyRecall } from "../../src/lib/verify/types";

const recalls = loadFixtureRecalls();
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
type Api = "ok" | "refused" | "untried";
let countApi = (client ? "untried" : "refused") as Api;
let refusal = "";
/** Read through a function, so the checks after the awaits see the value count() set. */
const apiIs = (v: Api) => countApi === v;

async function jpegSize(b: Buffer) {
  const m = await sharp(b).metadata();
  return { w: m.width ?? 0, h: m.height ?? 0 };
}

type Count = { total: number; images: number; text: number; exact: boolean };

async function count(photo: Buffer, recall: VerifyRecall, rule: VerifyProofRule, official: OfficialImage[]): Promise<Count> {
  const p = visionParams({ photo, recall, rule, official });
  let images = 0;
  for (const b of [photo, ...official.map((o) => o.jpeg)]) {
    const s = await jpegSize(b);
    images += visualTokens(s.w, s.h);
  }
  const textChars =
    VISION_SYSTEM.length +
    JSON.stringify(z.toJSONSchema(VisionReportSchema)).length +
    p.messages[0].content.reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);
  const text = Math.round(textChars / 3.5);
  if (client && countApi !== "refused") {
    try {
      const r = await client.beta.messages.countTokens({ model: p.model, system: p.system, messages: p.messages, output_config: { format: p.output_config.format } });
      countApi = "ok";
      return { total: r.input_tokens, images, text: r.input_tokens - images, exact: true };
    } catch (e) {
      countApi = "refused";
      refusal = String((e as Error).message).slice(0, 160);
    }
  }
  return { total: images + text, images, text, exact: false };
}

(async () => {
  const phone = await sharp(fixtureFile("other/commons-coffee-in-a-mug.jpg")).resize(4032, 3024).jpeg({ quality: 90 }).toBuffer();
  const cases = [
    ...loadFixtureCases().map((c) => ({ id: c.id, recall: c.recall, bytes: fixtureFile(c.photo) })),
    { id: "phone-12mp (mug photo enlarged to 4032x3024)", recall: "27056", bytes: phone },
    { id: "phone-12mp, rule needs a model number", recall: "27054", bytes: phone },
  ];
  const rows: Record<string, unknown>[] = [];
  for (const c of cases) {
    const { recall, rule } = recalls[c.recall];
    const before = {
      photo: (await decodeImage(c.bytes, LABEL_MAX_SIDE)).jpeg,
      official: (await loadOfficialImages(recall.images, undefined, 3)).images,
    };
    const rule2: VerifyProofRule = c.id.includes("model number") ? { ...rule, must_show: [...rule.must_show, "model_number"] } : rule;
    const after = {
      photo: (await decodeImage(c.bytes, claimMaxSide(rule2.must_show))).jpeg,
      official: pickForVision((await loadOfficialImages(recall.images, undefined, 5)).images),
    };
    const b = await count(before.photo, recall, rule2, before.official);
    const a = await count(after.photo, recall, rule2, after.official);
    rows.push({
      case: c.id,
      recall: c.recall,
      before: b.total,
      after: a.total,
      saved: b.total - a.total,
      "saved %": b.total ? Math.round(((b.total - a.total) / b.total) * 100) : 0,
      "image tokens before/after": `${b.images}/${a.images}`,
      counted: a.exact ? "count_tokens" : "est",
    });
  }
  console.table(rows);

  // The cached prefix (fixed instructions, schema, recall data and official images, up to the second breakpoint) per
  // recall, against the part each claim adds. Opus 5.5 caches prefixes of 512 tokens or more.
  const prefixRows: Record<string, unknown>[] = [];
  if (client && apiIs("ok")) {
    for (const [num, { recall, rule }] of Object.entries(recalls)) {
      const official = pickForVision((await loadOfficialImages(recall.images, undefined, 5)).images);
      const p = visionParams({ photo: fixtureFile("other/commons-coffee-in-a-mug.jpg"), recall, rule, official });
      const content = p.messages[0].content;
      const cut = content.findIndex((b) => "cache_control" in b && b.cache_control) + 1;
      const systemOnly = await client.beta.messages.countTokens({ model: p.model, system: p.system, messages: [{ role: "user", content: "." }], output_config: { format: p.output_config.format } });
      const prefix = await client.beta.messages.countTokens({ model: p.model, system: p.system, messages: [{ role: "user", content: content.slice(0, cut) }], output_config: { format: p.output_config.format } });
      const full = await client.beta.messages.countTokens({ model: p.model, system: p.system, messages: p.messages, output_config: { format: p.output_config.format } });
      prefixRows.push({ recall: num, "instructions + schema": systemOnly.input_tokens, "cached prefix": prefix.input_tokens, "per claim (1280x960 photo)": full.input_tokens - prefix.input_tokens, "prefix share %": Math.round((prefix.input_tokens / full.input_tokens) * 100) });
    }
    console.table(prefixRows);
  }
  if (apiIs("refused")) console.log(`count_tokens was not available on this account (${refusal || "no key"}); text tokens are estimated, image tokens are exact.`);
  writeFileSync(path.join(FIXTURES_DIR, "..", "tokens.json"), JSON.stringify({ measuredAt: new Date().toISOString(), method: apiIs("ok") ? "count_tokens" : "formula for images, 3.5 characters a token for text", rows, prefix: prefixRows }, null, 1) + "\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
