import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorize, bandIndex, assessRisk, normalizeProfile, weeklyCo2SavedKg,
  findBestWindow, parseAirQuality, whoMultiple, formatRange, DEFAULT_PROFILE,
} from '../js/engine.js';

test('categorize uses inclusive US AQI band edges', () => {
  const cases = [[0, 'good'], [50, 'good'], [51, 'moderate'], [100, 'moderate'], [101, 'sensitive'],
    [150, 'sensitive'], [151, 'unhealthy'], [200, 'unhealthy'], [201, 'very-unhealthy'],
    [300, 'very-unhealthy'], [301, 'hazardous'], [500, 'hazardous'], [999, 'hazardous']];
  for (const [aqi, key] of cases) assert.equal(categorize(aqi).key, key, `AQI ${aqi}`);
});

test('bandIndex rejects invalid AQI values', () => {
  for (const bad of [-1, NaN, Infinity, '80', null, undefined, 1001]) {
    assert.throws(() => bandIndex(bad), RangeError);
  }
});

test('normalizeProfile drops unknown keys and fixes bad values', () => {
  const p = normalizeProfile({ children: 'yes', commute: 'rocket', commuteKm: -5, cooking: 'biomass', __proto__x: 1, evil: true });
  assert.deepEqual(Object.keys(p).sort(), Object.keys(DEFAULT_PROFILE).sort());
  assert.equal(p.children, false, 'only real booleans count');
  assert.equal(p.commute, 'public');
  assert.equal(p.commuteKm, 0);
  assert.equal(p.cooking, 'biomass');
  assert.equal(normalizeProfile({ commuteKm: 5000 }).commuteKm, 200);
  assert.deepEqual(normalizeProfile(null), { ...DEFAULT_PROFILE });
});

test('assessRisk raises the level for sensitive and respiratory profiles', () => {
  assert.equal(assessRisk(40, {}).level, 0, 'good air stays good for everyone');
  assert.equal(assessRisk(40, { children: true }).level, 0);

  const healthy = assessRisk(120, {});
  assert.equal(healthy.level, 2);
  assert.equal(healthy.raised, false);

  const kids = assessRisk(120, { children: true });
  assert.equal(kids.level, 3);
  assert.equal(kids.raised, true);

  const asthma = assessRisk(120, { respiratory: true });
  assert.equal(asthma.level, 4, 'sensitive + respiratory bump');

  assert.equal(assessRisk(450, { respiratory: true }).level, 5, 'capped at hazardous');
});

test('weeklyCo2SavedKg computes and rounds avoided emissions', () => {
  // 10 km × 2 trips × 5 days × (0.17 − 0.03) = 14 kg
  assert.equal(weeklyCo2SavedKg({ km: 10, from: 'car', to: 'public' }), 14);
  assert.equal(weeklyCo2SavedKg({ km: 10, from: 'car', to: 'public', daysPerWeek: 1 }), 2.8);
  assert.equal(weeklyCo2SavedKg({ km: 10, from: 'public', to: 'car' }), 0, 'never negative');
  assert.throws(() => weeklyCo2SavedKg({ km: 10, from: 'jet', to: 'car' }), RangeError);
  assert.throws(() => weeklyCo2SavedKg({ km: -1, from: 'car', to: 'public' }), RangeError);
});

test('whoMultiple compares PM2.5 with the WHO 24 h guideline', () => {
  assert.equal(whoMultiple(15), 1);
  assert.equal(whoMultiple(150), 10);
  assert.equal(whoMultiple(null), null);
  assert.equal(whoMultiple(-3), null);
});

test('formatRange wraps around midnight', () => {
  assert.equal(formatRange('2026-11-23T14:00', 2), '14:00–16:00');
  assert.equal(formatRange('2026-11-23T23:00', 2), '23:00–01:00');
  assert.equal(formatRange('bad', 2), '');
});

const hourly = (values, start = 20) => values.map((pm25, i) => {
  const h = start + i;
  const day = h >= 24 ? 24 : 23;
  return { time: `2026-11-${day}T${String(h % 24).padStart(2, '0')}:00`, pm25, aqi: null };
});

test('findBestWindow finds the cleanest and dirtiest windows', () => {
  const data = hourly([200, 180, 90, 60, 70, 250, 300]);
  const w = findBestWindow(data, '2026-11-23T20:00');
  assert.equal(w.start, '2026-11-23T23:00', '60 + 70 is the lowest pair');
  assert.equal(w.best, 65);
  assert.equal(w.worst, 275);
  assert.equal(w.worstStart, '2026-11-24T01:00');
  assert.equal(w.reductionPct, 76);
  assert.equal(w.nextDay, false);
  assert.equal(w.worstNextDay, true);
});

test('findBestWindow skips past hours and gaps, and handles no data', () => {
  const data = hourly([10, 10, 300, null, 5, 200]);
  const w = findBestWindow(data, '2026-11-23T22:00');
  assert.ok(!['2026-11-23T20:00', '2026-11-23T21:00'].includes(w.start), 'past hours ignored');
  assert.notEqual(w.start, '2026-11-23T23:00', 'window containing null skipped');
  assert.equal(findBestWindow([], '2026-11-23T20:00'), null);
  assert.equal(findBestWindow(null, '2026-11-23T20:00'), null);
});

test('parseAirQuality reshapes a valid Open-Meteo response', () => {
  const json = {
    current: { time: '2026-11-23T21:00', us_aqi: 312.6, pm2_5: 210.4, pm10: 300, nitrogen_dioxide: 55, ozone: null },
    hourly: { time: ['2026-11-23T21:00', '2026-11-23T22:00'], pm2_5: [210, 190], us_aqi: [313, 300] },
  };
  const data = parseAirQuality(json);
  assert.equal(data.aqi, 313);
  assert.equal(data.pm25, 210.4);
  assert.equal(data.o3, null);
  assert.equal(data.hourly.length, 2);
  assert.deepEqual(data.hourly[1], { time: '2026-11-23T22:00', pm25: 190, aqi: 300 });
});

test('parseAirQuality rejects missing data', () => {
  assert.throws(() => parseAirQuality({}), (e) => e.code === 'noData');
  assert.throws(() => parseAirQuality({ current: { time: 'x', us_aqi: null } }), (e) => e.code === 'noData');
  assert.equal(parseAirQuality({ current: { time: 't', us_aqi: 10 } }).hourly.length, 0);
});

test('aqiScalePosition places AQI on six equal-width bands', async () => {
  const { aqiScalePosition } = await import('../js/engine.js');
  assert.equal(aqiScalePosition(0), 0);
  assert.equal(aqiScalePosition(50), 16.7, 'end of Good = 1/6');
  assert.equal(aqiScalePosition(100), 33.3);
  assert.equal(aqiScalePosition(175), 58.3, 'middle of Unhealthy');
  assert.equal(aqiScalePosition(400), 91.7, 'Hazardous scaled to 500');
  assert.equal(aqiScalePosition(900), 100, 'clamped');
  assert.throws(() => aqiScalePosition(-1), RangeError);
});
