/**
 * The second hash (src/lib/verify/phash.ts) for every stored official picture, from the committed 320 px thumbnails in
 * public/recalls (content/recalls/image-hashes.json names each one) and the sample recalls' own pictures in
 * public/samples (content/recalls/samples.json). Code only: no network, no model call, no database.
 *
 *   npx tsx scripts/recalls/phashes.ts
 *
 * Writes content/recalls/image-phashes.json as { note, hashes: { pictureUrl: phash } }. The new hash samples a 32 x 32
 * grid of the picture's center, so a 320 px thumbnail gives the hash the full picture would; tests/phash.test.ts checks
 * a sample of rows against a fresh run.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { phash } from "../../src/lib/verify/phash";

const root = process.cwd();
const dir = path.join(root, "content", "recalls");
const OUT = path.join(dir, "image-phashes.json");

type Entry = { url: string; thumb: string | null };

/** Each stored picture and the local file its hash is read from. */
export function pictureFiles(): { url: string; file: string }[] {
  const hashes = JSON.parse(readFileSync(path.join(dir, "image-hashes.json"), "utf8")) as Record<string, Entry[]>;
  const out: { url: string; file: string }[] = [];
  for (const list of Object.values(hashes)) for (const e of list) if (e.thumb) out.push({ url: e.url, file: path.join(root, "public", e.thumb.replace(/^\//, "")) });
  const samples = JSON.parse(readFileSync(path.join(dir, "samples.json"), "utf8")) as { recalls: { images: { url: string }[] }[] };
  for (const r of samples.recalls) for (const i of r.images) out.push({ url: i.url, file: path.join(root, "public", i.url.replace(/^\//, "")) });
  return out.filter((p) => existsSync(p.file));
}

async function main() {
  const files = pictureFiles();
  const hashes: Record<string, string> = {};
  for (const p of files) hashes[p.url] = await phash(readFileSync(p.file));
  writeFileSync(
    OUT,
    JSON.stringify({ note: "The second 64-bit hash (src/lib/verify/phash.ts) of every stored official picture, read from the committed thumbnails in public/recalls and the sample recalls' pictures in public/samples, by scripts/recalls/phashes.ts. US Consumer Product Safety Commission images, public domain.", count: files.length, hashes }, null, 1) + "\n",
  );
  console.log(`phashes: ${files.length} pictures hashed into content/recalls/image-phashes.json`);
}

if (process.argv[1] && /phashes\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
