/**
 * Builds the image data for Brightline Home's fictional sample recall (content/recalls/samples.json): the dHash of each
 * official image with the one dHash (src/lib/verify/dhash.ts) and 320 px WebP thumbnails in public/recalls/<number>/,
 * the same shape the CPSC images have. No network, no model calls.
 *
 *   npx tsx scripts/recalls/sample-recall.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { dhash } from "../../src/lib/verify/dhash";

const root = process.cwd();
const file = path.join(root, "content", "recalls", "samples.json");

type Img = { url: string; caption: string; file: string; dhash?: string; thumb?: string; width?: number; height?: number };
type SamplesFile = { recalls: { number: string; images: Img[] }[] };

(async () => {
  const data = JSON.parse(readFileSync(file, "utf8")) as SamplesFile;
  for (const r of data.recalls) {
    const dir = path.join(root, "public", "recalls", r.number);
    mkdirSync(dir, { recursive: true });
    for (const [i, img] of r.images.entries()) {
      const bytes = readFileSync(path.join(root, img.file));
      const meta = await sharp(bytes).metadata();
      img.dhash = await dhash(bytes);
      img.width = meta.width;
      img.height = meta.height;
      img.thumb = `/recalls/${r.number}/${i + 1}.webp`;
      await sharp(bytes).autoOrient().flatten({ background: "#ffffff" }).resize({ width: 320, withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(dir, `${i + 1}.webp`));
      console.log(`${r.number} image ${i + 1}: ${img.file} dhash ${img.dhash}, ${meta.width}x${meta.height}`);
    }
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
