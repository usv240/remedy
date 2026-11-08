import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The hosted site's daily Claude budget in dollars, read from render.yaml (AI_DAILY_USD), the one place it is set, so
 * the pages and the README cannot drift from it (tests/facts.test.ts). Null when the file or the key is missing.
 * Server only.
 */
export function hostedDailyUsd(): number | null {
  try {
    const yaml = readFileSync(path.join(process.cwd(), "render.yaml"), "utf8");
    const m = /key:\s*AI_DAILY_USD[^\n]*\n\s*value:\s*"?(\d+(?:\.\d+)?)"?/.exec(yaml);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
