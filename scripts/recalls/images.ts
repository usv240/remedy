/**
 * Download every photo-refund recall's official CPSC images, hash each one (64-bit dHash) and keep small thumbnails.
 *
 *   npx tsx scripts/recalls/images.ts [--all] [--rehash] [--concurrency 3]
 *
 * Polite: a few requests at a time, a short pause between them, a User-Agent naming the project, and a rerun only
 * fetches images it has not hashed yet. Writes content/recalls/image-hashes.json as
 * { recallNumber: [{ url, dhash, caption, thumb, width, height }] }. Thumbnails (WebP, 320 px wide) go to
 * public/recalls/<recall>/<n>.webp only if they total under 30 MB; otherwise only URLs and hashes are kept.
 * Images: US Consumer Product Safety Commission (cpsc.gov), public domain.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { USER_AGENT } from "../../src/lib/recall/cpsc-client";
// The one dHash (src/lib/verify/dhash.ts), so stored official hashes match claim hashes bit for bit.
import { dhash } from "../../src/lib/verify/dhash";
import type { RecallsFile } from "../../src/lib/recall/types";

const root = process.cwd();
const dir = path.join(root, "content", "recalls");
const outFile = path.join(dir, "image-hashes.json");
const thumbsTmp = path.join(dir, ".thumbs-tmp");
const thumbsPublic = path.join(root, "public", "recalls");
const LIMIT_BYTES = 30 * 1024 * 1024;
const ci = process.argv.indexOf("--concurrency");
const concurrency = ci > 0 ? Number(process.argv[ci + 1]) : 3;
const all = process.argv.includes("--all");
/** Hash every image again (after a change to the hash), instead of reusing earlier hashes. */
const rehash = process.argv.includes("--rehash");

type Entry = { url: string; dhash: string; caption: string; thumb: string | null; width: number; height: number; bytes: number };
type Out = Record<string, Entry[]>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function download(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "image/*" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(1500 * attempt);
    }
  }
}

async function main() {
  const file = JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as RecallsFile;
  const recalls = file.recalls.filter((r) => all || r.photoRefund);
  const prev: Out = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
  const known = new Map(Object.values(prev).flat().map((e) => [e.url, e]));
  const jobs = recalls.flatMap((r) => r.images.map((img, i) => ({ recall: r.number, i, url: img.url, caption: img.caption })));
  console.log(`${recalls.length} recalls, ${jobs.length} official images (${jobs.filter((j) => known.has(j.url)).length} already hashed)`);
  mkdirSync(thumbsTmp, { recursive: true });

  const results = new Map<string, Entry>();
  const failed: { url: string; error: string }[] = [];
  const queue = [...jobs];
  let done = 0;
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const tmp = path.join(thumbsTmp, j.recall, `${j.i + 1}.webp`);
      const old = known.get(j.url);
      if (old && !rehash && (!old.thumb || existsSync(path.join(root, "public", old.thumb.replace(/^\//, ""))) || existsSync(tmp))) {
        results.set(`${j.recall}#${j.i}`, old);
      } else {
        try {
          const buf = await download(j.url);
          const meta = await sharp(buf, { failOn: "none" }).metadata();
          const hash = await dhash(buf);
          mkdirSync(path.dirname(tmp), { recursive: true });
          await sharp(buf, { failOn: "none" }).autoOrient().flatten({ background: "#ffffff" }).resize({ width: 320, withoutEnlargement: true }).webp({ quality: 72 }).toFile(tmp);
          results.set(`${j.recall}#${j.i}`, { url: j.url, dhash: hash, caption: j.caption, thumb: `/recalls/${j.recall}/${j.i + 1}.webp`, width: meta.width ?? 0, height: meta.height ?? 0, bytes: buf.length });
          await sleep(250);
        } catch (e) {
          failed.push({ url: j.url, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (++done % 100 === 0) console.log(`${done}/${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Thumbnails: keep them only if the whole set is under 30 MB.
  const { readdirSync, statSync, cpSync } = await import("node:fs");
  const sizeOf = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, f) => s + sizeOf(path.join(p, f)), 0) : statSync(p).size);
  const tmpBytes = existsSync(thumbsTmp) ? sizeOf(thumbsTmp) : 0;
  const pubBytes = existsSync(thumbsPublic) ? sizeOf(thumbsPublic) : 0;
  const keepThumbs = tmpBytes + pubBytes < LIMIT_BYTES;
  if (keepThumbs) {
    mkdirSync(thumbsPublic, { recursive: true });
    cpSync(thumbsTmp, thumbsPublic, { recursive: true });
    writeFileSync(
      path.join(thumbsPublic, "CREDITS.txt"),
      "Official recall images from the US Consumer Product Safety Commission (cpsc.gov), public domain. Resized to 320 px wide WebP thumbnails for Remedy. Each recall's page on cpsc.gov holds the originals.\n",
    );
  }
  rmSync(thumbsTmp, { recursive: true, force: true });

  const out: Out = {};
  for (const r of recalls) {
    const list = r.images.map((_, i) => results.get(`${r.number}#${i}`)).filter((e): e is Entry => Boolean(e));
    if (list.length) out[r.number] = keepThumbs ? list : list.map((e) => ({ ...e, thumb: null }));
  }
  writeFileSync(outFile, JSON.stringify(out, null, 1));
  const totalThumbs = existsSync(thumbsPublic) ? sizeOf(thumbsPublic) : 0;
  console.log(
    `image-hashes.json: ${Object.values(out).flat().length} images over ${Object.keys(out).length} recalls; ${failed.length} failed; thumbnails ${keepThumbs ? `kept in public/recalls (${(totalThumbs / 1e6).toFixed(1)} MB)` : `not kept (${((tmpBytes + pubBytes) / 1e6).toFixed(1)} MB is over 30 MB)`}`,
  );
  if (failed.length) writeFileSync(path.join(dir, "image-failures.json"), JSON.stringify(failed, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
