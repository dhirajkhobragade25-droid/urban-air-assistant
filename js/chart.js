/**
 * Geometry for the 24-hour PM2.5 curve. Pure functions: no DOM.
 *
 * The line uses monotone cubic interpolation (Fritsch–Carlson), so it is
 * smooth but never overshoots the data — it cannot dip below zero or invent
 * a peak that the forecast does not have.
 */

export const CHART_HOURS = 24;

/** The next 24 forecast hours that have a PM2.5 value, from `fromTime`. */
export function forecastSeries(hourly, fromTime) {
  if (!Array.isArray(hourly) || typeof fromTime !== 'string') return [];
  const start = hourly.findIndex((h) => h && typeof h.time === 'string' && h.time >= fromTime);
  if (start < 0) return [];
  return hourly.slice(start, start + CHART_HOURS)
    .map((h, offset) => ({ time: h.time, offset, pm25: h.pm25 }))
    .filter((p) => Number.isFinite(p.pm25) && p.pm25 >= 0);
}

/** A round upper bound for the y axis, never below `floor`. */
export function niceMax(values, floor = 60) {
  const max = Math.max(floor, ...values);
  const step = max > 200 ? 50 : max > 100 ? 25 : 10;
  return Math.ceil((max * 1.1) / step) * step;
}

/** Fritsch–Carlson tangents for monotone cubic interpolation. */
function monotoneTangents(xs, ys) {
  const n = xs.length;
  const d = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }
  return m;
}

const f = (n) => Math.round(n * 10) / 10;

/** SVG path data for a smooth monotone line through points [{x, y}]. */
export function smoothPath(points) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${f(points[0].x)} ${f(points[0].y)}`;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const m = monotoneTangents(xs, ys);
  let path = `M${f(xs[0])} ${f(ys[0])}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    path += `C${f(xs[i] + dx)} ${f(ys[i] + m[i] * dx)} ${f(xs[i + 1] - dx)} ${f(ys[i + 1] - m[i + 1] * dx)} ${f(xs[i + 1])} ${f(ys[i + 1])}`;
  }
  return path;
}

/**
 * Everything needed to draw the curve in a width × height box.
 * @returns {null | {points:Array, line:string, area:string, yMax:number, x:Function, y:Function}}
 */
export function buildCurve(series, { width = 320, height = 140 } = {}) {
  if (!Array.isArray(series) || series.length < 4) return null;
  const yMax = niceMax(series.map((p) => p.pm25));
  const x = (offset) => (offset / (CHART_HOURS - 1)) * width;
  const y = (value) => height - (Math.min(value, yMax) / yMax) * height;
  const points = series.map((p) => ({ ...p, x: x(p.offset), y: y(p.pm25) }));
  const line = smoothPath(points);
  const last = points[points.length - 1];
  const area = `${line}L${f(last.x)} ${height}L${f(points[0].x)} ${height}Z`;
  return { points, line, area, yMax, x, y };
}

/* ---------- AQI ring gauge ---------- */

/**
 * The hero's ring: a 270° dial split into the six AQI bands, opening at the
 * bottom. Coordinates are in a 200 × 200 viewBox; angles in degrees, SVG
 * style (0° points right, clockwise is positive).
 */
export const GAUGE = Object.freeze({ cx: 100, cy: 100, r: 84, start: 135, sweep: 270, gap: 6, segments: 6 });

const round2 = (n) => Math.round(n * 100) / 100;
const clampPct = (n) => Math.min(Math.max(Number(n) || 0, 0), 100);

/** A point on the ring at `angle`. */
export function polarPoint(angle, r = GAUGE.r, g = GAUGE) {
  const t = (angle * Math.PI) / 180;
  return { x: round2(g.cx + r * Math.cos(t)), y: round2(g.cy + r * Math.sin(t)) };
}

/** SVG path for a clockwise arc from angle a0 to a1. */
export function arcPath(a0, a1, r = GAUGE.r, g = GAUGE) {
  const p0 = polarPoint(a0, r, g);
  const p1 = polarPoint(a1, r, g);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${p0.x} ${p0.y}A${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

/** The six band segments of the dial, with a small gap between each. */
export function gaugeSegments(g = GAUGE) {
  const each = g.sweep / g.segments;
  return Array.from({ length: g.segments }, (_, i) => {
    const a0 = g.start + i * each + g.gap / 2;
    const a1 = g.start + (i + 1) * each - g.gap / 2;
    return { a0, a1, d: arcPath(a0, a1, g.r, g) };
  });
}

/** Where the marker sits for a scale position (0–100, from aqiScalePosition). */
export function gaugeAngle(position, g = GAUGE) {
  return round2(g.start + (clampPct(position) / 100) * g.sweep);
}

/** How much of each band segment is lit (0–1) for a scale position. */
export function gaugeFills(position, g = GAUGE) {
  const p = clampPct(position) / 100;
  return Array.from({ length: g.segments }, (_, i) => round2(Math.min(Math.max((p - i / g.segments) * g.segments, 0), 1)));
}
