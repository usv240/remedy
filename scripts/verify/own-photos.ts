/**
 * Brings photos taken for a sample recall into the fixture set the way the app stores a claim photo: each original is
 * read from a folder outside the repo and passed through storedCopy (src/lib/ops/photos.ts), which turns it upright,
 * resizes it to at most 1,600 px and re-encodes it as JPEG with no EXIF, GPS or camera data. Only that copy is written;
 * the original is never copied. No model call, no network.
 *
 *   npx tsx scripts/verify/own-photos.ts --from "../own-photos" --to own
 *
 * The folder holds before/ (the product as sold), after/ (made safe) and tricks/ (named shots); any other subfolder is
 * copied the same way. Copies land in content/verify/fixtures/<to>/<subfolder>/<name>.jpg. For each photo it prints
 * what the original carried (location, camera) and checks the copy carries none.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { storedCopy } from "../../src/lib/ops/photos";
import { FIXTURES_DIR } from "../../src/lib/verify/fixtures";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const from = path.resolve(arg("--from") ?? path.join("..", "own-photos"));
const to = arg("--to") ?? "own";
const IMAGE = /\.(jpe?g|png|webp|heic|heif)$/i;

/** Whether EXIF data names a GPS block (tag 0x8825), in either byte order. */
const hasGps = (exif: Buffer | undefined) => Boolean(exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]))));
const slug = (name: string) =>
  path
    .basename(name, path.extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

(async () => {
  if (!existsSync(from)) throw new Error(`No folder at ${from}. Put the photos in before/, after/ and tricks/ there.`);
  const rows: Record<string, unknown>[] = [];
  let problems = 0;
  for (const sub of readdirSync(from).filter((d) => statSync(path.join(from, d)).isDirectory())) {
    for (const file of readdirSync(path.join(from, sub)).filter((f) => IMAGE.test(f))) {
      const original = readFileSync(path.join(from, sub, file));
      if (/\.hei[cf]$/i.test(file)) {
        rows.push({ photo: `${sub}/${file}`, result: "HEIC cannot be read here: please send it as JPEG" });
        problems++;
        continue;
      }
      const before = await sharp(original).metadata();
      const copy = await storedCopy(original);
      if (!copy) {
        rows.push({ photo: `${sub}/${file}`, result: "could not be read" });
        problems++;
        continue;
      }
      const after = await sharp(copy.bytes).metadata();
      const clean = !after.exif && !after.xmp && !after.iptc;
      if (!clean) problems++;
      const rel = path.posix.join(to, sub, `${slug(file)}.jpg`);
      mkdirSync(path.join(FIXTURES_DIR, to, sub), { recursive: true });
      writeFileSync(path.join(FIXTURES_DIR, rel), copy.bytes);
      rows.push({
        photo: `${sub}/${file}`,
        "original had location": hasGps(before.exif),
        "original had camera data": Boolean(before.exif),
        stored: rel,
        size: `${copy.width}x${copy.height}`,
        "stored copy clean": clean,
      });
    }
  }
  console.table(rows);
  if (!rows.length) throw new Error(`No photos found in the subfolders of ${from}.`);
  if (problems) throw new Error(`${problems} photo(s) need attention (see the table).`);
  console.log(`Stored ${rows.length} photo(s) under content/verify/fixtures/${to}/, with no location or camera data. The originals were not copied.`);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
