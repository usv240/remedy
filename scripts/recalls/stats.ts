/**
 * Reproduce the published recall numbers and write content/recalls/stats.json.
 *
 *   npx tsx scripts/recalls/stats.ts
 *
 * Three runs of the same classifier:
 *   1. "validation": the 2026-11-01 snapshot behind research/validation_recalls.md (must match it exactly),
 *   2. "current": today's pull (content/recalls/recalls.json), the numbers to publish,
 *   3. "currentSameWindow": today's pull cut to the validation window, to explain any difference.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeAll } from "../../src/lib/recall/ingest";
import { computeStats, type RecallStats } from "../../src/lib/recall/stats";
import type { RawCpscRecall, RecallsFile } from "../../src/lib/recall/types";

const dir = path.join(process.cwd(), "content", "recalls");
const snapshot = normalizeAll(JSON.parse(readFileSync(path.join(dir, "raw", "cpsc-recalls-2026-11-01.json"), "utf8")) as RawCpscRecall[]);
const current = JSON.parse(readFileSync(path.join(dir, "recalls.json"), "utf8")) as RecallsFile;

/** research/validation_recalls.md, pulled 2026-11-01. */
const PUBLISHED = {
  recalls: 1227,
  under50k: 994,
  under10k: 721,
  soldOnline: 980,
  refund: 772,
  recallVendor: 46,
  madeInChina: 883,
  photo: 614,
  photoRefund: 523,
  photoRefundEmail: 496,
  photoRefundWebmail: 269,
  photoRefund2024: 71,
  photoRefund2025: 172,
  photoRefund2026: 280,
  paypalOrVenmo: 0,
};
type Key = keyof typeof PUBLISHED;
const pick = (s: RecallStats): Record<Key, number> => ({
  recalls: s.recalls.count,
  under50k: s.all.under50k.count,
  under10k: s.all.under10k.count,
  soldOnline: s.all.soldOnline.count,
  refund: s.all.refund.count,
  recallVendor: s.all.recallVendor.count,
  madeInChina: s.all.madeInChina.count,
  photo: s.all.photo.count,
  photoRefund: s.all.photoRefund.count,
  photoRefundEmail: s.photoRefund.email.count,
  photoRefundWebmail: s.photoRefund.webmail.count,
  photoRefund2024: s.byYear["2024"]?.photoRefund ?? 0,
  photoRefund2025: s.byYear["2025"]?.photoRefund ?? 0,
  photoRefund2026: s.byYear["2026"]?.photoRefund ?? 0,
  paypalOrVenmo: s.all.paypalOrVenmo.count,
});

const validation = computeStats(snapshot);
const now = computeStats(current.recalls);
const window = computeStats(current.recalls.filter((r) => r.date <= "2026-10-29"));
const v = pick(validation);
const c = pick(now);
const w = pick(window);

const snapNums = new Set(snapshot.map((r) => r.number));
const curNums = new Set(current.recalls.map((r) => r.number));
const added = current.recalls.filter((r) => !snapNums.has(r.number));
const removed = snapshot.filter((r) => !curNums.has(r.number));
const snapBy = new Map(snapshot.map((r) => [r.number, r]));
const changed = current.recalls.filter((r) => {
  const o = snapBy.get(r.number);
  return o && (o.photoRefund !== r.photoRefund || o.flags.webmail !== r.flags.webmail || o.flags.email !== r.flags.email || o.units !== r.units);
});

/** Known, explained differences from the published numbers. */
const UNITS_NOTE =
  "Recall 24078 (Alliance4Safety and 31 furniture companies, 2024-01-11) gives its units as \"Millions\", with no number. The 2026-11-01 scan read that as 0 units and counted it under 10,000 and under 50,000; this classifier reads it as not given and leaves it out. The shares do not change when rounded: 993 of 1,227 is 81% and 720 of 1,227 is 59%.";
const EXPLAINED: Partial<Record<Key, string>> = { under50k: UNITS_NOTE, under10k: UNITS_NOTE };

const comparison = (Object.keys(PUBLISHED) as Key[]).map((k) => ({
  measure: k,
  published: PUBLISHED[k],
  reproduced: v[k],
  matches: v[k] === PUBLISHED[k],
  current: c[k],
  currentSameWindow: w[k],
  ...(v[k] !== PUBLISHED[k] && EXPLAINED[k] ? { explained: EXPLAINED[k] } : {}),
}));

const out = {
  generatedAt: new Date().toISOString(),
  source: current.source,
  note:
    "Counts from the deterministic classifier in src/lib/recall/classify.ts. 'validation' re-runs it on the 2026-11-01 snapshot behind research/validation_recalls.md; 'current' is today's pull and is the set to publish.",
  current: { pulledAt: current.pulledAt, ...now },
  validation: { pulledAt: "2026-11-01", ...validation },
  comparison,
  difference: {
    added: added.map((r) => ({ number: r.number, date: r.date, title: r.title, photoRefund: r.photoRefund })),
    removed: removed.map((r) => ({ number: r.number, date: r.date, title: r.title })),
    reclassified: changed.map((r) => ({ number: r.number, date: r.date, title: r.title })),
    units: UNITS_NOTE,
    explanation: `The current pull has ${added.length} recall(s) not in the 2026-11-01 snapshot (dated ${[...new Set(added.map((r) => r.date))].sort().join(", ") || "none"}), ${removed.length} removed, and ${changed.length} whose counted fields changed. Inside the validation window (to 2026-10-29) the current pull gives the same numbers as the snapshot: ${comparison.every((x) => x.currentSameWindow === x.reproduced) ? "yes" : "no, see comparison"}.`,
  },
};
writeFileSync(path.join(dir, "stats.json"), JSON.stringify(out, null, 1));

console.table(comparison.map(({ explained, ...x }) => ({ ...x, explained: explained ? "yes" : "" })));
console.log(out.difference.explanation);
console.log(
  `Current: ${now.recalls.count} recalls ${now.range.from} to ${now.range.to}; photo-refund ${now.all.photoRefund.count} (${now.all.photoRefund.share}%); webmail ${now.photoRefund.webmail.count} (${now.photoRefund.webmail.share}% of photo-refund); marker ${now.photoRefund.marker.count}, cut ${now.photoRefund.cut.count} of photo-refund`,
);
const unexplained = comparison.filter((x) => !x.matches && !("explained" in x));
if (unexplained.length) {
  console.error(`Unexplained differences: ${unexplained.map((x) => x.measure).join(", ")}`);
  process.exitCode = 1;
}
