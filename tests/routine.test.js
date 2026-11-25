import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_IDS,
  DEFAULT_ROUTINE,
  ROUTINE_HOURS,
  normalizeRoutine,
  planRoutine,
  summarizeImpact,
  describeRoutineItem,
  formatHour,
  PM25_UNHEALTHY,
} from '../js/routine.js';
import { createTranslator } from '../js/i18n.js';

/** Two days of hourly PM2.5 from a function of the hour. */
function forecast(fn) {
  const out = [];
  for (const day of ['2026-11-25', '2026-11-26']) {
    for (let h = 0; h < 24; h += 1) {
      out.push({ time: `${day}T${String(h).padStart(2, '0')}:00`, pm25: fn(h, day), aqi: null });
    }
  }
  return out;
}
// Smoggy morning and night, cleaner afternoon (minimum at 15:00–16:00).
const smoggy = forecast((h) => {
  if (h >= 13 && h <= 17) return 40;
  if (h >= 10 && h <= 12) return 90;
  return 160;
});
const NOW = '2026-11-25T07:00';
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

test('formatHour pads to HH:00 and the time picker covers 05:00–22:00', () => {
  assert.equal(formatHour(8), '08:00');
  assert.equal(formatHour(17), '17:00');
  assert.equal(ROUTINE_HOURS[0], 5);
  assert.equal(ROUTINE_HOURS.at(-1), 22);
});

test('normalizeRoutine keeps valid hours, nulls and defaults, drops junk', () => {
  assert.deepEqual(normalizeRoutine(null), { ...DEFAULT_ROUTINE });
  const r = normalizeRoutine({ 'commute': '8', 'errands': null, 'kids-play': 99, 'hacker': 3, 'school-run': 7.5 });
  assert.equal(r.commute, 8);
  assert.equal(r.errands, null);
  assert.equal(r['kids-play'], DEFAULT_ROUTINE['kids-play'], 'out of range → default');
  assert.equal(r['school-run'], DEFAULT_ROUTINE['school-run'], 'non-integer → default');
  assert.deepEqual(Object.keys(r).sort(), [...ACTIVITY_IDS].sort());
});

test('with a forecast, activities move to cleaner hours inside their window', () => {
  const items = byId(
    planRoutine({
      routine: { 'errands': 11, 'commute': 9, 'evening-walk': 19 },
      aqi: 250,
      hourly: smoggy,
      fromTime: NOW,
    }),
  );
  assert.equal(items.errands.status, 'move');
  assert.equal(items.errands.bestHour, 13, 'first of the cleanest hours');
  assert.equal(items.errands.reductionPct, 56); // 90 → 40
  assert.equal(items.errands.note, 'mask', '40 µg/m³ is still above the moderate band');
  assert.equal(items.commute.status, 'move', 'commute window 07–11 reaches 10:00');
  assert.equal(items.commute.bestHour, 10);
  assert.equal(items['evening-walk'].bestHour, 16, 'walk window starts at 16:00');
  assert.equal(items['evening-walk'].note, 'easy');
});

test('a time that has already passed today is compared with the rest of today', () => {
  const [item] = planRoutine({
    routine: { 'outdoor-exercise': 6, 'commute': null, 'errands': null, 'evening-walk': null },
    aqi: 250,
    hourly: smoggy,
    fromTime: NOW,
  });
  assert.equal(item.status, 'move');
  assert.equal(item.bestHour, 13);
  assert.equal(item.nextDay, false, 'the cleaner slot is later today');
  assert.equal(item.reductionPct, 75); // 160 → 40
});

test('hard exercise goes indoors when even the best hour is unhealthy', () => {
  const allBad = forecast(() => PM25_UNHEALTHY + 30);
  const items = byId(
    planRoutine({ routine: { 'kids-play': 17, 'errands': 11 }, aqi: 300, hourly: allBad, fromTime: NOW }),
  );
  assert.equal(items['kids-play'].status, 'indoors');
  assert.equal(items['kids-play'].note, null);
  assert.equal(items.errands.status, 'keep', 'light errands stay, with a mask');
  assert.equal(items.errands.note, 'mask');
});

test('small gains are not worth moving for', () => {
  const flat = forecast((h) => 30 + (h === 11 ? 3 : 0));
  const [item] = planRoutine({
    routine: { 'errands': 11, 'commute': null, 'evening-walk': null },
    aqi: 60,
    hourly: flat,
    fromTime: NOW,
  });
  assert.equal(item.status, 'keep');
  assert.equal(item.reductionPct, 0);
  assert.equal(item.note, null, 'clean enough for no mask');
});

test('without a forecast the AQI decides, and work-from-home skips the commute', () => {
  const items = byId(
    planRoutine({ routine: { 'kids-play': 17, 'errands': 11, 'commute': 9 }, aqi: 180, commute: 'wfh' }),
  );
  assert.equal(items.commute, undefined);
  assert.equal(items['kids-play'].status, 'indoors');
  assert.equal(items['kids-play'].live, false);
  assert.equal(items.errands.status, 'keep');
  assert.equal(items.errands.note, 'mask');
  const moderate = byId(planRoutine({ routine: { 'evening-walk': 19, 'errands': 11 }, aqi: 120 }));
  assert.equal(moderate['evening-walk'].note, 'easy');
  const clean = byId(planRoutine({ routine: { 'evening-walk': 19 }, aqi: 40 }));
  assert.equal(clean['evening-walk'].note, null);
});

test('items are ordered by the time the family actually goes out', () => {
  const items = planRoutine({
    routine: { 'outdoor-exercise': 6, 'commute': 9, 'errands': 11 },
    aqi: 250,
    hourly: smoggy,
    fromTime: NOW,
  });
  const times = items.map((i) => (i.status === 'move' ? i.bestHour : i.hour));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  );
});

test('summarizeImpact adds up CO₂ and exposure savings', () => {
  const routinePlan = planRoutine({
    routine: { 'commute': 9, 'errands': 11, 'kids-play': 17, 'evening-walk': null },
    aqi: 250,
    hourly: smoggy,
    fromTime: NOW,
  });
  const summary = summarizeImpact({ profile: { commute: 'car', commuteKm: 10 }, routinePlan });
  assert.equal(summary.weeklyCo2Kg, 8.4); // 10 km × 2 × 3 days × (0.17 − 0.03)
  assert.equal(summary.movedCount, 2, 'commute and errands move; 17:00 play is already clean');
  assert.ok(summary.avgReductionPct > 40);
  assert.equal(summarizeImpact({ profile: { commute: 'public', commuteKm: 10 }, routinePlan: [] }).weeklyCo2Kg, 0);
});

test('describeRoutineItem explains each decision in English and Hindi', () => {
  const [item] = planRoutine({
    routine: { 'errands': 11, 'commute': null, 'evening-walk': null },
    aqi: 250,
    hourly: smoggy,
    fromTime: NOW,
  });
  const en = describeRoutineItem(item, createTranslator('en'));
  assert.equal(en.name, 'Market and errands');
  assert.equal(en.tag, 'Move');
  assert.equal(en.text, 'Move to 13:00 instead of 11:00. PM2.5 90 → 40 µg/m³: about 56% less smoke breathed in.');
  assert.equal(en.note, 'Wear an N95 for this trip.');
  const hi = describeRoutineItem(item, createTranslator('hi'));
  assert.match(hi.text, /11:00 की जगह 13:00 करें/);

  const [sim] = planRoutine({
    routine: { 'kids-play': 17, 'commute': null, 'errands': null, 'evening-walk': null },
    aqi: 200,
  });
  assert.match(describeRoutineItem(sim, createTranslator('en')).text, /too smoky/);
});

test('chat answers timing questions from the day plan, and the Gemini prompt carries it', async () => {
  const { localAnswer, buildUserPrompt, detectIntent } = await import('../js/assistant.js');
  const { buildContext, buildPlan } = await import('../js/advice.js');
  assert.equal(detectIntent('When should we go out today?'), 'routine');
  assert.equal(detectIntent('आज हम कब बाहर जाएँ?'), 'routine');
  assert.equal(detectIntent('Do I need a mask?'), 'mask');

  const ctx = buildContext({ aqi: 250, profile: {} });
  const routinePlan = planRoutine({
    routine: { 'errands': 11, 'commute': null, 'evening-walk': null },
    aqi: 250,
    hourly: smoggy,
    fromTime: NOW,
  });
  const en = createTranslator('en');
  const answer = localAnswer({
    question: 'When should we go out today?',
    plan: buildPlan(ctx),
    risk: ctx.risk,
    translate: en,
    routinePlan,
  });
  assert.match(answer, /Your day:/);
  assert.match(answer, /• Market and errands: Move to 13:00 instead of 11:00/);
  assert.match(answer, /Wear an N95 for this trip\./);

  const prompt = buildUserPrompt({
    question: 'when?',
    place: 'Delhi',
    snapshot: null,
    risk: ctx.risk,
    profile: ctx.profile,
    plan: buildPlan(ctx),
    translate: en,
    routinePlan,
  });
  assert.match(prompt, /"dailyRoutinePlan":\["Market and errands: Move to 13:00/);
});
