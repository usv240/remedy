import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");

/** The custom properties in the first block that starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** [foreground, background, minimum]: 4.5 for text, 3 for component edges and chart marks. */
const PAIRS: [string, string, number][] = [
  ["ink", "bg", 4.5],
  ["ink", "surface", 4.5],
  ["ink", "surface-2", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "surface-2", 4.5],
  ["accent-ink", "accent", 4.5],
  ["accent-text", "bg", 4.5],
  ["link", "surface", 4.5],
  ["link", "bg", 4.5],
  ["attention", "surface", 4.5],
  ["positive", "surface", 4.5],
  ["pill-positive-ink", "pill-positive", 4.5],
  ["pill-attention-ink", "pill-attention", 4.5],
  ["pill-info-ink", "pill-info", 4.5],
  ["pill-neutral-ink", "pill-neutral", 4.5],
  ["invert-ink", "invert-bg", 4.5],
  ["invert-muted", "invert-bg", 4.5],
  ["accent-edge", "bg", 3],
  ["control", "surface", 3],
  ["chart-1", "surface", 3],
  ["chart-2", "surface", 3],
  ["chart-3", "surface", 3],
];

describe("colour tokens", () => {
  const themes = { light: tokens(':root[data-theme="light"]'), dark: tokens(':root[data-theme="dark"]'), system: tokens(':root[data-theme="system"]') };

  it("light is the default theme", () => {
    expect(css.indexOf(":root,\n:root[data-theme=\"light\"]")).toBeGreaterThan(-1);
  });

  it("the system theme's dark tokens match the dark theme", () => {
    expect(themes.system).toEqual(themes.dark);
  });

  for (const [name, t] of Object.entries({ light: themes.light, dark: themes.dark })) {
    it(`${name}: every pair meets WCAG 2.2 AA`, () => {
      for (const [fg, bg, min] of PAIRS) {
        expect(t[fg], `${name} --${fg}`).toBeDefined();
        expect(t[bg], `${name} --${bg}`).toBeDefined();
        expect(ratio(t[fg], t[bg]), `${name} --${fg} on --${bg}`).toBeGreaterThanOrEqual(min);
      }
    });
  }

  it("dark and light define the same tokens", () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });
});
