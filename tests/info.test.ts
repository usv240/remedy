import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import info from "../content/info.json";

type Entry = { title: string; what: string; why: string; technical?: string };
const INFO = info as Record<string, Entry>;
const SRC = join(__dirname, "..", "src");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Every Info id written literally in the code: <Info id="..."> and the Display menu's infoId="...". */
function literalIds(): string[] {
  const ids = new Set<string>();
  for (const f of files(SRC)) for (const m of readFileSync(f, "utf8").matchAll(/(?:<Info\s+id|infoId)=["']([\w.-]+)["']/g)) ids.add(m[1]);
  return [...ids];
}

const ids = (text: string) => [...text.matchAll(/\bid: "([\w-]+)"/g)].map((m) => m[1]);

describe("Info coverage", () => {
  it("every Info id in the code has an entry", () => {
    const missing = literalIds().filter((id) => !INFO[id]);
    expect(missing).toEqual([]);
  });

  it("every tool in the stack strip and on /stack has an entry", () => {
    const tools = new Set([...ids(read("components", "StackStrip.tsx")), ...ids(read("app", "stack", "page.tsx"))]);
    expect([...tools].filter((id) => !INFO[`stack.${id}`])).toEqual([]);
  });

  it("every service on /status has an entry", () => {
    const page = read("app", "status", "page.tsx");
    const map = Object.fromEntries([...(/const INFO[^=]*=\s*(\{[^}]*\})/.exec(page)?.[1] ?? "{}").matchAll(/["']?([\w-]+)["']?:\s*"([\w-]+)"/g)].map((m) => [m[1], m[2]]));
    const services = ids(read("lib", "health.ts"));
    expect(services.length).toBeGreaterThan(8);
    expect(services.filter((id) => !INFO[`stack.${map[id] ?? id}`])).toEqual([]);
  });

  it("every entry says what and why, in plain copy", () => {
    for (const [id, e] of Object.entries(INFO)) {
      expect(e.title, id).toBeTruthy();
      expect(e.what, id).toBeTruthy();
      expect(e.why, id).toBeTruthy();
      const text = JSON.stringify(e);
      expect(text, `${id}: no em dashes`).not.toMatch(/—/);
      expect(text, `${id}: no emoji`).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text, `${id}: kind words only`).not.toMatch(/\b(fraud|fake|scam)/i);
    }
  });
});
