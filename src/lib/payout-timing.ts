import measuredFile from "../../content/public/measured.json";
import transcript from "../../content/public/e2e-transcript.json";

/**
 * How long a PayPal payout takes from approval to SUCCESS, counted from both records the suites keep: the first runs,
 * kept in content/public/measured.json as their range and count (the payout item's `earlier`), and every later passing run
 * in content/public/e2e-transcript.json (`payoutRuns`, one entry per run of tests/e2e/claim.mjs and
 * tests/e2e/try-payout.mjs, written by tests/e2e/transcript.mjs). The range and the run count everywhere on the site, the README and docs/*.md come from
 * payoutTiming(); tests/facts.test.ts holds them to it. Static JSON imports, so a page can use it while it prerenders.
 */
type Earlier = { ranOn: string; runs: number; minS: number; maxS: number; suite: string };
type Item = { id: string; figure?: string; what?: string; source?: string; earlier?: Earlier };
type Suite = { ranAt: string; failed: number; ids: { approval_to_paid_s?: number } };

export type PayoutRun = { suite: string; ranAt: string; seconds: number };

export function payoutTiming() {
  const item = (measuredFile.items as Item[]).find((i) => i.id === "payout");
  const earlier = item?.earlier ?? null;
  // Every passing run the transcript kept (payoutRuns, one per run), else the last run of each suite. A run counts once
  // it ran after the earlier runs were taken, so none is counted twice.
  const t = transcript as { suites: Record<string, Suite>; payoutRuns?: { suite: string; ranAt: string; seconds: number }[] };
  const kept = t.payoutRuns?.length
    ? t.payoutRuns.map((r) => ({ name: r.suite, ranAt: r.ranAt, seconds: r.seconds }))
    : Object.entries(t.suites)
        .filter(([, s]) => typeof s.ids.approval_to_paid_s === "number" && s.failed === 0)
        .map(([name, s]) => ({ name, ranAt: s.ranAt, seconds: s.ids.approval_to_paid_s! }));
  const later: PayoutRun[] = kept
    .filter((r) => !earlier || r.ranAt.slice(0, 10) > earlier.ranOn)
    .map((r) => ({ suite: `tests/e2e/${r.name}.mjs`, ranAt: r.ranAt, seconds: r.seconds }))
    .sort((a, b) => a.ranAt.localeCompare(b.ranAt));
  const lows = [...(earlier ? [earlier.minS] : []), ...later.map((r) => r.seconds)];
  const highs = [...(earlier ? [earlier.maxS] : []), ...later.map((r) => r.seconds)];
  if (!lows.length) return null;
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const runs = (earlier?.runs ?? 0) + later.length;
  const figure = min === max ? `${min} s` : `${min} to ${max} s`;
  return {
    min,
    max,
    runs,
    /** "16 to 19 s". */
    figure,
    /** "16 to 19 seconds". */
    seconds: figure.replace(/ s$/, " seconds"),
    /** The largest, for "about N seconds". */
    about: max,
    what: `from approval to a PayPal payout reaching SUCCESS, in ${runs} sandbox runs`,
    source: [...new Set([earlier?.suite, ...later.map((r) => r.suite)].filter(Boolean))].join(" and "),
    earlier,
    later,
  };
}

export type Measured = { note: string; measuredAt: string; environment: string; items: { id: string; figure: string; what: string; source: string }[] };

/** content/public/measured.json with the payout's figure, wording and source counted by payoutTiming(). */
export function measured(): Measured {
  const t = payoutTiming();
  return {
    note: measuredFile.note,
    measuredAt: measuredFile.measuredAt,
    environment: measuredFile.environment,
    items: (measuredFile.items as Item[]).flatMap((i) => {
      if (i.id !== "payout") return [{ id: i.id, figure: i.figure ?? "", what: i.what ?? "", source: i.source ?? "" }];
      return t ? [{ id: i.id, figure: t.figure, what: t.what, source: t.source }] : [];
    }),
  };
}
