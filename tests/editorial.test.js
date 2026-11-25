import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlineFor, pollutantRatios, categorize, findBestWindow, WHO_GUIDELINES } from '../js/engine.js';
import { forecastSeries, buildCurve, smoothPath, niceMax, CHART_HOURS } from '../js/chart.js';
import { formatClock, createTranslator } from '../js/i18n.js';

const hours = (fn, from = '2026-11-25T00:00') => {
  const out = [];
  for (const day of ['2026-11-25', '2026-11-26']) {
    for (let h = 0; h < 24; h += 1) out.push({ time: `${day}T${String(h).padStart(2, '0')}:00`, pm25: fn(h, day), aqi: null });
  }
  return out.filter((h) => h.time >= from);
};

test('formatClock gives editorial times in both languages', () => {
  assert.equal(formatClock('en', 0), '12 AM');
  assert.equal(formatClock('en', 9), '9 AM');
  assert.equal(formatClock('en', 12), '12 PM');
  assert.equal(formatClock('en', 16), '4 PM');
  assert.equal(formatClock('hi', 7), 'सुबह 7 बजे');
  assert.equal(formatClock('hi', 14), 'दोपहर 2 बजे');
  assert.equal(formatClock('hi', 17), 'शाम 5 बजे');
  assert.equal(formatClock('hi', 23), 'रात 11 बजे');
});

test('headline says "cleaner later" when smog is bad now and lifts in the afternoon', () => {
  const hourly = hours((h) => (h >= 14 && h <= 17 ? 40 : 200));
  const snapshot = { time: '2026-11-25T07:00', aqi: 320, pm25: 200, hourly };
  const window = findBestWindow(hourly, snapshot.time);
  const head = headlineFor({ band: categorize(320), snapshot, window });
  assert.equal(head.nowKey, 'head.now.hazardous');
  assert.deepEqual(head.next, { key: 'head.next.cleaner', hour: 14, nextDay: false });
  const T = createTranslator('en');
  assert.equal(`${T(head.nowKey)} ${T(head.next.key, { clock: formatClock('en', 14), nextDay: false })}`,
    'Dangerous smog now. Cleaner air around 2 PM.');
});

test('headline warns when clean air now turns smoky tonight', () => {
  const hourly = hours((h) => (h >= 19 ? 150 : 20));
  const snapshot = { time: '2026-11-25T10:00', aqi: 60, pm25: 20, hourly };
  const head = headlineFor({ band: categorize(60), snapshot, window: findBestWindow(hourly, snapshot.time) });
  assert.equal(head.next.key, 'head.next.worse');
  assert.equal(head.next.hour, 19);
});

test('headline is steady for flat forecasts and quiet in what-if mode', () => {
  const hourly = hours(() => 30);
  const snapshot = { time: '2026-11-25T10:00', aqi: 90, pm25: 30, hourly };
  assert.equal(headlineFor({ band: categorize(90), snapshot, window: findBestWindow(hourly, snapshot.time) }).next.key, 'head.next.steady');
  assert.equal(headlineFor({ band: categorize(90), snapshot: null, window: null }).next, null, 'what-if mode has no forecast line');
  assert.equal(headlineFor({ band: categorize(90), snapshot, window: null }).next, null);
});

test('pollutantRatios compares each reading with its WHO guideline', () => {
  const ratios = pollutantRatios({ pm25: 205.3, pm10: 90, no2: 12.4, o3: null });
  assert.deepEqual(ratios.map((r) => r.key), ['pm25', 'pm10', 'no2']);
  assert.deepEqual(ratios[0], { key: 'pm25', value: 205, guideline: WHO_GUIDELINES.pm25, ratio: 13.7 });
  assert.equal(ratios[1].ratio, 2);
  assert.equal(ratios[2].ratio, 0.5);
  assert.deepEqual(pollutantRatios(null), []);
});

test('forecastSeries takes the next 24 hours from now and skips gaps', () => {
  const hourly = hours((h) => (h === 12 ? null : 50));
  const series = forecastSeries(hourly, '2026-11-25T07:00');
  assert.equal(series[0].time, '2026-11-25T07:00');
  assert.equal(series[0].offset, 0);
  assert.equal(series.length, CHART_HOURS - 1, 'the null hour is dropped');
  assert.ok(!series.some((p) => p.time === '2026-11-25T12:00'));
  assert.deepEqual(forecastSeries(null, 'x'), []);
});

test('niceMax rounds the axis up and keeps a sensible floor', () => {
  assert.equal(niceMax([20, 30]), 70);
  assert.equal(niceMax([180]), 200);
  assert.equal(niceMax([420]), 500);
});

test('the smooth curve passes through every point and never overshoots', () => {
  const pts = [{ x: 0, y: 100 }, { x: 10, y: 20 }, { x: 20, y: 20 }, { x: 30, y: 90 }, { x: 40, y: 10 }];
  const path = smoothPath(pts);
  assert.match(path, /^M0 100C/);
  for (const p of pts.slice(1)) assert.ok(path.includes(` ${p.x} ${p.y}`), `passes through ${p.x},${p.y}`);
  const ys = [...path.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  assert.ok(Math.min(...ys) >= 10 && Math.max(...ys) <= 100, 'control points stay inside the data range');
  assert.equal(smoothPath([]), '');
  assert.equal(smoothPath([{ x: 1, y: 2 }]), 'M1 2');
});

test('buildCurve maps the series into the box and closes the area', () => {
  const series = forecastSeries(hours((h) => 40 + h), '2026-11-25T00:00');
  const curve = buildCurve(series, { width: 230, height: 100 });
  assert.equal(curve.points.length, 24);
  assert.equal(curve.points[0].x, 0);
  assert.equal(curve.points.at(-1).x, 230);
  assert.ok(curve.points.every((p) => p.y >= 0 && p.y <= 100));
  assert.match(curve.area, /Z$/);
  assert.equal(buildCurve(series.slice(0, 3)), null, 'too few points to draw');
});

test('a sudden jump in PM2.5 is drawn without overshoot', () => {
  // A smoke plume arriving within an hour: tangents must be limited (Fritsch–Carlson step 5).
  const pts = [{ x: 0, y: 100 }, { x: 10, y: 99 }, { x: 20, y: 0 }, { x: 30, y: 1 }];
  const ys = [...smoothPath(pts).matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 100, `stays within 0–100, got ${Math.min(...ys)}–${Math.max(...ys)}`);
});
