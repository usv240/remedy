import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/evidence-index.md names a file, and often a line, behind every claim. Each path must exist, each `path:line`
 * must be inside the file, and where a line is followed by a symbol in parentheses, `path:line` (`symbol`), that line
 * must contain the symbol, so the index cannot drift from the code it points at.
 */
const ROOT = process.cwd();
const INDEX = readFileSync(path.join(ROOT, "docs", "evidence-index.md"), "utf8");
const REPO_PATH = /`((?:src|content|tests|scripts|docs|public|db)\/[\w./\-[\]]+?)(?::(\d+)(?:-(\d+))?)?`(?: \(`([^`]+)`\))?/g;

describe("docs/evidence-index.md", () => {
  const refs = [...INDEX.matchAll(REPO_PATH)].map((m) => ({ file: m[1], line: m[2] ? Number(m[2]) : null, to: m[3] ? Number(m[3]) : null, symbol: m[4] ?? null }));

  it("has ten rows, each with a live place, a file and a test", () => {
    const rows = INDEX.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      expect(cells.length, row).toBeGreaterThanOrEqual(6);
      expect(cells[3], `live column: ${row}`).toMatch(/\//);
      expect(cells[4], `evidence column: ${row}`).toMatch(REPO_PATH);
      expect(cells[5], `test column: ${row}`).toMatch(/tests\//);
    }
  });

  it("names only files that exist", () => {
    expect(refs.length).toBeGreaterThan(20);
    const missing = refs.map((r) => r.file).filter((f) => !existsSync(path.join(ROOT, f)));
    expect(missing).toEqual([]);
  });

  it("every line it names is inside its file, and the named symbol is on that line", () => {
    for (const r of refs) {
      if (r.line === null) continue;
      const lines = readFileSync(path.join(ROOT, r.file), "utf8").split(/\r?\n/);
      expect(r.line, `${r.file}:${r.line}`).toBeLessThanOrEqual(lines.length);
      if (r.to !== null) expect(r.to, `${r.file}:${r.line}-${r.to}`).toBeLessThanOrEqual(lines.length);
      if (r.symbol) expect(lines[r.line - 1], `${r.file}:${r.line} should contain ${r.symbol}`).toContain(r.symbol);
    }
  });

  it("is linked from the README's top", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    expect(readme.indexOf("docs/evidence-index.md")).toBeGreaterThan(0);
    expect(readme.indexOf("docs/evidence-index.md")).toBeLessThan(readme.indexOf("## Run it yourself"));
  });
});
