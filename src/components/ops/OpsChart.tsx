import type { HourPoint } from "@/lib/ops/data";

const W = 1120;
const H = 240;
const PAD = { l: 44, r: 12, t: 12, b: 28 };

/**
 * Requests and errors per hour over seven days, drawn as inline SVG in code: a filled line for requests, bars for
 * errors, both in the theme's chart colors so it reads in light and dark. The numbers are also in a visually hidden
 * table for screen readers.
 */
export function OpsChart({ points }: { points: HourPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.requests));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / Math.max(1, points.length - 1)) * iw;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.requests).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(PAD.t + ih).toFixed(1)} L${x(0).toFixed(1)},${(PAD.t + ih).toFixed(1)} Z`;
  const total = points.reduce((s, p) => s + p.requests, 0);
  const errors = points.reduce((s, p) => s + p.errors, 0);
  const days = points.map((p, i) => ({ i, d: new Date(p.hour) })).filter(({ d }) => d.getUTCHours() === 0);
  const ticks = [0, Math.round(max / 2), max];
  const bw = Math.max(1.5, iw / points.length - 0.5);
  const summary = `${total.toLocaleString("en-US")} requests and ${errors.toLocaleString("en-US")} server errors over the last 7 days, by hour; the busiest hour had ${max.toLocaleString("en-US")}.`;
  return (
    <figure className="ops-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="none">
        <title>{summary}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="ops-chart-grid" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="ops-chart-tick">
              {t}
            </text>
          </g>
        ))}
        {days.map(({ i, d }) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={PAD.t} y2={PAD.t + ih} className="ops-chart-day" />
            <text x={x(i) + 4} y={H - 8} className="ops-chart-tick">
              {d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
            </text>
          </g>
        ))}
        <path d={area} className="ops-chart-area" />
        <path d={line} className="ops-chart-line" />
        {points.map((p, i) => (p.errors ? <rect key={i} x={x(i) - bw / 2} y={y(p.errors)} width={bw} height={PAD.t + ih - y(p.errors)} className="ops-chart-err" /> : null))}
      </svg>
      <figcaption className="ops-chart-legend">
        <span>
          <i className="ops-swatch" data-k="req" aria-hidden="true" /> Requests per hour
        </span>
        <span>
          <i className="ops-swatch" data-k="err" aria-hidden="true" /> Server errors per hour
        </span>
        <span className="muted tabular">
          {total.toLocaleString("en-US")} requests, {errors.toLocaleString("en-US")} errors, UTC hours
        </span>
      </figcaption>
      <div className="sr-only">
        <table>
        <caption>Requests and server errors per hour, last 7 days</caption>
        <thead>
          <tr>
            <th scope="col">Hour (UTC)</th>
            <th scope="col">Requests</th>
            <th scope="col">Errors</th>
          </tr>
        </thead>
        <tbody>
          {points
            .filter((p) => p.requests || p.errors)
            .map((p) => (
              <tr key={p.hour}>
                <td>{p.hour.slice(0, 13).replace("T", " ")}</td>
                <td>{p.requests}</td>
                <td>{p.errors}</td>
              </tr>
            ))}
        </tbody>
        </table>
      </div>
    </figure>
  );
}
