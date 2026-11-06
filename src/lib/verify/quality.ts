import type { Grey } from "./image";
import type { Guidance, QualityIssue, QualityReport } from "./types";

/**
 * Quality precheck, before any model call: is the photo sharp enough, lit well enough and big enough to check?
 *
 * Sharpness is the variance of the Laplacian (kernel 0 1 0 / 1 -4 1 / 0 1 0) on a greyscale copy at most 512 px on its
 * longest side. A product photo is often mostly plain background, so the image is split into a 4 x 4 grid and the score
 * is the mean of the three sharpest tiles: it asks "is the product in focus?", not "is the wall in focus?".
 * Thresholds were set on the fixtures in content/verify/fixtures (see tests/verify-quality.test.ts).
 */

export const QUALITY_LIMITS = {
  /**
   * Mean Laplacian variance of the three sharpest tiles. On the fixtures: sharp official images 620 to 3,370, the CC0
   * phone photo 138 (98 after a 1 px blur, 42 after 2 px), and the 8 px blurred copy 5. Set low on purpose: a soft
   * photo that is still readable goes on to the vision check, which asks for a retake if it cannot see enough.
   */
  minSharpness: 35,
  /** Mean brightness 0 to 255, and the 95th percentile, both below these: too dark. */
  darkMean: 45,
  darkP95: 100,
  /** 5th percentile above this: washed out by light. */
  brightP05: 235,
  /** Shortest side in pixels. */
  minSide: 240,
} as const;

const GRID = 4;
const TOP_TILES = 3;

function laplacian(g: Grey) {
  const { data, width: w, height: h } = g;
  const tileSum = new Float64Array(GRID * GRID);
  const tileSq = new Float64Array(GRID * GRID);
  const tileN = new Float64Array(GRID * GRID);
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    const ty = Math.min(GRID - 1, Math.floor((y * GRID) / h));
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
      const t = ty * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / w));
      tileSum[t] += v;
      tileSq[t] += v * v;
      tileN[t] += 1;
      sum += v;
      sq += v * v;
      n += 1;
    }
  }
  const variance = (s: number, q: number, c: number) => (c > 0 ? q / c - (s / c) ** 2 : 0);
  const tiles = Array.from({ length: GRID * GRID }, (_, t) => variance(tileSum[t], tileSq[t], tileN[t])).sort((a, b) => b - a);
  const top = tiles.slice(0, TOP_TILES);
  return { global: variance(sum, sq, n), sharpness: top.reduce((a, b) => a + b, 0) / Math.max(1, top.length) };
}

function lumaStats(g: Grey) {
  const hist = new Uint32Array(256);
  let sum = 0;
  for (const v of g.data) {
    hist[v]++;
    sum += v;
  }
  const total = g.data.length || 1;
  const pct = (p: number) => {
    const target = p * total;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  return { mean: sum / total, p95: pct(0.95), p05: pct(0.05) };
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Pure: takes the greyscale copy and the original size. */
export function assessQuality(g: Grey, original: { width: number; height: number }): QualityReport {
  const lap = laplacian(g);
  const luma = lumaStats(g);
  const issues: QualityIssue[] = [];
  if (Math.min(original.width, original.height) < QUALITY_LIMITS.minSide) issues.push("small");
  if (luma.mean < QUALITY_LIMITS.darkMean && luma.p95 < QUALITY_LIMITS.darkP95) issues.push("dark");
  if (luma.p05 > QUALITY_LIMITS.brightP05) issues.push("bright");
  // A dark photo also measures soft; name the light first and only add blur when it is not just darkness.
  if (lap.sharpness < QUALITY_LIMITS.minSharpness && !issues.includes("dark")) issues.push("blurry");
  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      width: original.width,
      height: original.height,
      sharpness: round(lap.sharpness),
      laplacianVariance: round(lap.global),
      meanLuma: round(luma.mean),
      p95Luma: luma.p95,
      p05Luma: luma.p05,
    },
  };
}

const STEP: Record<QualityIssue, string> = {
  blurry: "Hold the phone still and tap the screen on the product to focus.",
  dark: "Move to a brighter spot, or turn on a light.",
  bright: "Move out of direct sun or glare so the details show.",
  small: "Move closer so the product fills most of the photo.",
};

const LEAD: Record<QualityIssue, string> = {
  blurry: "The photo is a bit blurry.",
  dark: "The photo is a bit dark.",
  bright: "The photo is too bright to see the details.",
  small: "The photo is too small to check.",
};

export function qualityGuidance(q: QualityReport): Guidance {
  const first = q.issues[0];
  return {
    plain: `${first ? LEAD[first] : "The photo is hard to check."} Please take it again.`,
    steps: q.issues.map((i) => STEP[i]),
    technical: `Quality precheck: sharpness ${q.metrics.sharpness} (min ${QUALITY_LIMITS.minSharpness}), mean luma ${q.metrics.meanLuma}, p95 ${q.metrics.p95Luma}, p05 ${q.metrics.p05Luma}, size ${q.metrics.width}x${q.metrics.height} (min side ${QUALITY_LIMITS.minSide}). Issues: ${q.issues.join(", ") || "none"}.`,
  };
}
