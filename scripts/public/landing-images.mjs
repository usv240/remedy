// Web copies of the pictures the public pages show, in public/landing/ and public/samples/charger/. Most are CPSC
// recall images (US government works, public domain), credited on the page; the mug photos are derived from a CC0
// photo by Kurt Kaiser, and the charger photos (Brightline Home's fictional sample recall) are public-domain photos by
// Dmitry G on Wikimedia Commons (public/samples/charger/CREDITS.json).
// Usage: node scripts/public/landing-images.mjs
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const F = "content/verify/fixtures";
const OUT = "public/landing";
mkdirSync(OUT, { recursive: true });

const jobs = [
  // Recall 26125: the CPSC's example of the hair dryer made safe, its power cord cut in half. Native 682 x 436.
  { from: `${F}/official/26125-hair-dryer-cord-cut.png`, to: "cord-cut-26125.webp", width: 682 },
  { from: `${F}/official/26125-hair-dryer-cord-cut.png`, to: "cord-cut-26125-sm.webp", width: 360 },
  // Recall 25007: the CPSC's example photos of the helmet made safe, straps cut off.
  { from: `${F}/official/25007-droyd-4-straps-cut.jpg`, to: "helmet-straps-25007.webp", width: 1100 },
  { from: `${F}/official/25007-droyd-4-straps-cut.jpg`, to: "helmet-straps-25007-sm.webp", width: 600 },
  { from: `${F}/official/25007-droyd-5-in-trash.jpg`, to: "helmet-trash-25007.webp", width: 720 },
  // Try-panel thumbnails.
  { from: `${F}/official/27056-haiara-1.jpg`, to: "power-bank-27056.webp", width: 360 },
  { from: `${F}/derived/commons-coffee-in-a-mug.blur8.jpg`, to: "blurry-mug.webp", width: 360 },
  { from: `${F}/other/commons-coffee-in-a-mug.jpg`, to: "mug.webp", width: 360 },
  { from: `${F}/sample/cord-cut.jpg`, to: "charger-cord-cut.webp", width: 360 },
  // /try's photos of the sample charger made safe, and opened up with its cord still attached.
  { from: `${F}/sample/opened-cord-attached.jpg`, to: "../samples/charger/opened-cord-attached-sm.webp", width: 320 },
  { from: `${F}/sample/opened-case.jpg`, to: "../samples/charger/opened-case-sm.webp", width: 320 },
];

for (const j of jobs) {
  const info = await sharp(j.from).resize({ width: j.width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(OUT, j.to));
  console.log(`${j.to} ${info.width}x${info.height} ${Math.round(info.size / 1024)} KB`);
}
