/**
 * Records a firm joining the shared hash pool from outside the app: four real `curl` calls against a running Remedy
 * (the curl binary, not fetch, so the calls come from another process), written to content/public/hash-pool-call.json
 * for /evidence#network.
 *
 *   REMEDY_DEV_KEY=rm_test_... REMEDY_FIRM_KEY=rm_test_... BASE_URL=http://localhost:3400 npx tsx scripts/public/record-hash-pool-call.ts
 *
 * REMEDY_DEV_KEY is a self-serve sandbox key from /developers; REMEDY_FIRM_KEY is Brightline Home's own firm key
 * (scripts/hash-pool-key.ts --firm brightline-home). Neither key is ever written to the file.
 * 1. The self-serve key tries to register the sample charger's hash: refused, 403, because only a key tied to a
 *    connected firm may write to the pool.
 * 2. Brightline Home's firm key registers it for its sample recall BH-2026-01 as partner ref "partner-demo-1".
 * 3. Check the same hash for Fernway Home's sample recall FW-2026-01, with no key: a hit at 0 bits, source partner, ref only.
 * 4. Check the hash of a photo of a mug (Wikimedia Commons, CC0) for FW-2026-01: no hit.
 * The script fails loudly when any step does not answer as expected. Both firms and recalls are fictional samples.
 *
 * The row it registers is a real pool entry: on that database, the sample charger photo is then held as already used
 * when it is claimed again on BH-2026-01 (the pool working as designed). To run the sample shop demo again on the same
 * database afterwards, remove the demo row: delete from image_hash where source = 'partner' and ref = 'partner-demo-1'.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { photoHashes } from "@/lib/verify";
import { FIXTURES_DIR } from "@/lib/verify/fixtures";

const B = (process.env.BASE_URL ?? "http://localhost:3400").replace(/\/$/, "");
const KEY = process.env.REMEDY_FIRM_KEY ?? "";
const SELF_SERVE = process.env.REMEDY_DEV_KEY ?? "";
const OUT = path.join(process.cwd(), "content", "public", "hash-pool-call.json");
const MASK = "rm_test_...";

type Call = { step: string; why: string; command: string; status: number; ms: number; response: unknown };

/** Run curl itself; the recorded command shows the key masked, the real one is only in the process arguments. */
function curl(step: string, why: string, url: string, body: unknown, key: string | null): Call {
  const args = ["-sS", "-o", "-", "-w", "\n%{http_code}", "-X", "POST", "-H", "Content-Type: application/json"];
  if (key) args.push("-H", `Authorization: Bearer ${key}`);
  args.push("-d", JSON.stringify(body), url);
  const shown = `curl -X POST -H "Content-Type: application/json"${key ? ` -H "Authorization: Bearer ${MASK}"` : ""} -d '${JSON.stringify(body)}' ${url}`;
  const t0 = performance.now();
  const r = spawnSync("curl", args, { encoding: "utf8" });
  const ms = Math.round(performance.now() - t0);
  if (r.error) throw new Error(`curl could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`curl exited ${r.status} on ${step}: ${(r.stderr ?? "").replace(key ?? "\u0000", MASK)}`);
  const out = r.stdout ?? "";
  const cut = out.lastIndexOf("\n");
  const status = Number(out.slice(cut + 1));
  let response: unknown;
  try {
    response = JSON.parse(out.slice(0, cut));
  } catch {
    throw new Error(`${step}: the server did not answer JSON (status ${status}).`);
  }
  if (key && JSON.stringify(response).includes(key)) throw new Error(`${step}: the answer echoed the key; not recorded.`);
  return { step, why, command: shown, status, ms, response };
}

async function main() {
  if (!KEY.startsWith("rm_test_")) throw new Error("REMEDY_FIRM_KEY is not set to an rm_test_ key. Issue one with scripts/hash-pool-key.ts --firm brightline-home.");
  if (!SELF_SERVE.startsWith("rm_test_")) throw new Error("REMEDY_DEV_KEY is not set to an rm_test_ key. Create one on /developers and pass it in the environment.");
  const charger = (await photoHashes(readFileSync(path.join(FIXTURES_DIR, "sample/cord-cut.jpg")))).dhash;
  const mug = (await photoHashes(readFileSync(path.join(FIXTURES_DIR, "other/commons-coffee-in-a-mug.jpg")))).dhash;
  const ref = "partner-demo-1";

  const refused = curl("register-self-serve", "A self-serve sandbox key from the Developers page tries to register the same hash: only a key tied to a connected firm may write to the pool.", `${B}/api/v1/hash-pool/register`, { dhash: charger, recall_number: "BH-2026-01", ref }, SELF_SERVE);
  const refusedErr = (refused.response as { error?: { code?: string } }).error;
  if (refused.status !== 403 || refusedErr?.code !== "forbidden") throw new Error(`a self-serve key was not refused: ${refused.status} ${JSON.stringify(refused.response)}`);

  const reg = curl("register", "Brightline Home has paid a claim on this photo and registers its hash for its own recall, with its own firm key and opaque ref.", `${B}/api/v1/hash-pool/register`, { dhash: charger, recall_number: "BH-2026-01", ref }, KEY);
  const regData = (reg.response as { data?: { registered?: boolean; ref?: string; dhash?: string } }).data;
  if (reg.status !== 200 || regData?.ref !== ref || regData?.dhash !== charger) throw new Error(`register answered ${reg.status}: ${JSON.stringify(reg.response)}`);

  const hit = curl("check-hit", "Fernway Home receives the same photo on its own recall and asks the pool with the hash alone.", `${B}/api/v1/hash-pool/check`, { dhash: charger, recall_number: "FW-2026-01" }, null);
  const hitData = (hit.response as { data?: { hit?: boolean; distance?: number; ref?: string; source?: string; threshold_bits?: number } }).data;
  if (hit.status !== 200 || hitData?.hit !== true || hitData.distance !== 0 || hitData.ref !== ref || hitData.threshold_bits !== 4) throw new Error(`check (hit) answered ${hit.status}: ${JSON.stringify(hit.response)}`);
  if (JSON.stringify(hit.response).includes("BH-2026-01")) throw new Error("The hit named the holder's recall; nothing but the ref may cross.");

  const miss = curl("check-no-hit", "A photo of a mug, never claimed anywhere, asked the same way: no hit.", `${B}/api/v1/hash-pool/check`, { dhash: mug, recall_number: "FW-2026-01" }, null);
  const missData = (miss.response as { data?: { hit?: boolean } }).data;
  if (miss.status !== 200 || missData?.hit !== false) throw new Error(`check (no hit) answered ${miss.status}: ${JSON.stringify(miss.response)}`);

  const out = {
    note: "A firm joining the shared hash pool from outside the app: four real curl calls against a local production build, recorded by scripts/public/record-hash-pool-call.ts. A self-serve sandbox key is refused (403) when it tries to register; Brightline Home's own firm key registers, both shown masked. The firm is kept in Remedy's audit ledger, never on the pool row, so a hit names no firm. Only the 64-bit hash and an opaque ref cross. Brightline Home, Fernway Home and their recalls are fictional samples; the photo is the sample charger (Dmitry G, Wikimedia Commons, public domain) and the mug is Kurt Kaiser, CC0.",
    recordedAt: new Date().toISOString(),
    crossed: ["dhash", "ref"],
    calls: [refused, reg, hit, miss],
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`hash pool call: self-serve key refused (${refused.status}), registered ${ref} (${reg.ms} ms), hit at ${hitData.distance} bits (${hit.ms} ms), mug no hit (${miss.ms} ms). Wrote ${path.relative(process.cwd(), OUT)}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
