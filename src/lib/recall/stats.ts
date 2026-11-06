/**
 * The published recall numbers, computed from normalized recalls with the deterministic classifier. Pure, so the
 * stats script and the tests share it. Every number travels with its definition.
 */
import { DEFINITIONS, ONLINE_RE, PAYPAL_RE, VENDOR_RE, unitsBucket, type UnitsBucket } from "./classify";
import type { Recall } from "./types";

export type Measures = {
  photo: boolean;
  refund: boolean;
  photoRefund: boolean;
  marker: boolean;
  cut: boolean;
  email: boolean;
  webmail: boolean;
  paypal: boolean;
  online: boolean;
  china: boolean;
  vendor: boolean;
  units: number | null;
  year: string;
};

export function measures(r: Recall): Measures {
  return {
    ...r.flags,
    photoRefund: r.flags.photo && r.flags.refund,
    paypal: PAYPAL_RE.test(`${r.remedyText} ${r.consumerContact}`),
    online: ONLINE_RE.test(r.retailers.join(" ")),
    china: r.countries.includes("China"),
    vendor: VENDOR_RE.test(r.consumerContact),
    units: r.units,
    year: r.date.slice(0, 4),
  };
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
type Stat = { count: number; share: number | null; of: string; definition: string };
const stat = (count: number, of: number, ofLabel: string, definition: string): Stat => ({ count, share: of ? pct(count, of) : null, of: ofLabel, definition });

export function computeStats(recalls: Recall[]) {
  const m = recalls.map((r) => ({ r, x: measures(r) }));
  const N = m.length;
  const pr = m.filter((e) => e.x.photoRefund);
  const P = pr.length;
  const count = (xs: typeof m, f: (x: Measures) => boolean) => xs.filter((e) => f(e.x)).length;
  const dates = recalls.map((r) => r.date).filter(Boolean).sort();
  const years = [...new Set(m.map((e) => e.x.year))].sort();
  const buckets: UnitsBucket[] = ["under 1,000", "1,000 to 9,999", "10,000 to 49,999", "50,000 to 999,999", "1 million or more", "not given"];
  return {
    range: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    recalls: stat(N, 0, "", DEFINITIONS.recalls),
    all: {
      photo: stat(count(m, (x) => x.photo), N, "all recalls", DEFINITIONS.photo),
      refund: stat(count(m, (x) => x.refund), N, "all recalls", DEFINITIONS.refund),
      photoRefund: stat(P, N, "all recalls", DEFINITIONS.photoRefund),
      marker: stat(count(m, (x) => x.marker), N, "all recalls", DEFINITIONS.marker),
      cut: stat(count(m, (x) => x.cut), N, "all recalls", DEFINITIONS.cut),
      email: stat(count(m, (x) => x.email), N, "all recalls", DEFINITIONS.email),
      webmail: stat(count(m, (x) => x.webmail), N, "all recalls", DEFINITIONS.webmail),
      paypalOrVenmo: stat(count(m, (x) => x.paypal), N, "all recalls", DEFINITIONS.paypal),
      soldOnline: stat(count(m, (x) => x.online), N, "all recalls", DEFINITIONS.online),
      madeInChina: stat(count(m, (x) => x.china), N, "all recalls", DEFINITIONS.china),
      recallVendor: stat(count(m, (x) => x.vendor), N, "all recalls", DEFINITIONS.vendor),
      under50k: stat(count(m, (x) => x.units !== null && x.units < 50_000), N, "all recalls", `${DEFINITIONS.units} Units under 50,000.`),
      under10k: stat(count(m, (x) => x.units !== null && x.units < 10_000), N, "all recalls", `${DEFINITIONS.units} Units under 10,000.`),
    },
    photoRefund: {
      email: stat(count(pr, (x) => x.email), P, "photo-refund recalls", DEFINITIONS.email),
      webmail: stat(count(pr, (x) => x.webmail), P, "photo-refund recalls", DEFINITIONS.webmail),
      marker: stat(count(pr, (x) => x.marker), P, "photo-refund recalls", DEFINITIONS.marker),
      cut: stat(count(pr, (x) => x.cut), P, "photo-refund recalls", DEFINITIONS.cut),
      markerOrCut: stat(count(pr, (x) => x.marker || x.cut), P, "photo-refund recalls", "Marker or cut."),
      under50k: stat(count(pr, (x) => x.units !== null && x.units < 50_000), P, "photo-refund recalls", `${DEFINITIONS.units} Units under 50,000.`),
    },
    byYear: Object.fromEntries(
      years.map((y) => {
        const ym = m.filter((e) => e.x.year === y);
        return [y, { recalls: ym.length, photo: count(ym, (x) => x.photo), photoRefund: count(ym, (x) => x.photoRefund), webmail: count(ym, (x) => x.photoRefund && x.webmail) }];
      }),
    ) as Record<string, { recalls: number; photo: number; photoRefund: number; webmail: number }>,
    unitsBuckets: {
      definition: DEFINITIONS.units,
      all: Object.fromEntries(buckets.map((b) => [b, m.filter((e) => unitsBucket(e.x.units) === b).length])),
      photoRefund: Object.fromEntries(buckets.map((b) => [b, pr.filter((e) => unitsBucket(e.x.units) === b).length])),
    },
  };
}
export type RecallStats = ReturnType<typeof computeStats>;
