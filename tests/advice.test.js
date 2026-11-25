import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, buildPlan, flattenPlan, CATEGORIES, MAX_PER_CATEGORY, ADVICE_IDS } from '../js/advice.js';

const ids = (plan) => flattenPlan(plan).map((rec) => rec.id);
const planFor = (aqi, profile = {}, window = null) => buildPlan(buildContext({ aqi, profile, window }));

test('clean air gives positive, outdoor-friendly advice', () => {
  const list = ids(planFor(30, { commute: 'public' }));
  assert.ok(list.includes('outdoor-go'));
  assert.ok(list.includes('ventilate'));
  assert.ok(!list.includes('mask'));
  assert.ok(!list.includes('windows'));
});

test('hazardous air triggers emergency and mask advice first', () => {
  const plan = planFor(380);
  assert.equal(plan.health[0].id, 'emergency');
  assert.equal(plan.health[0].priority, 1);
  assert.ok(ids(plan).includes('mask'));
  assert.ok(ids(plan).includes('windows'));
  assert.ok(ids(plan).includes('diy-purifier'), 'no purifier → DIY option');
});

test('sensitive households get extra protection earlier', () => {
  const healthy = ids(planFor(120));
  const family = ids(planFor(120, { children: true, respiratory: true }));
  assert.ok(!healthy.includes('sensitive'));
  assert.ok(family.includes('sensitive'));
  assert.ok(family.includes('children'));
  assert.ok(family.includes('meds'));
  assert.ok(family.includes('mask'), 'personal level reaches "unhealthy"');
});

test('car commuters get quantified CO₂ impact', () => {
  const plan = planFor(180, { commute: 'car', commuteKm: 15 });
  const today = flattenPlan(plan).find((rec) => rec.id === 'commute-today');
  assert.deepEqual(today.params, { km: 15, kg: 4.2 }); // 15 × 2 × (0.17 − 0.03)
  const weekly = flattenPlan(plan).find((rec) => rec.id === 'transit-default');
  assert.equal(weekly.params.kg, 12.6); // three days a week
  assert.ok(ids(plan).includes('idling'));
});

test('work-from-home advice explains vehicle savings only for drivers', () => {
  const driver = flattenPlan(planFor(250, { commute: 'two_wheeler', commuteKm: 10 })).find((r) => r.id === 'wfh');
  assert.equal(driver.whyId, 'wfh-vehicle');
  assert.equal(driver.params.kg, 1); // 10 km × 2 trips × 0.05 kg × 1 day
  const rider = flattenPlan(planFor(250, { commute: 'public' })).find((r) => r.id === 'wfh');
  assert.equal(rider.whyId, undefined);
  assert.ok(!ids(planFor(250, { commute: 'wfh' })).includes('wfh'));
});

test('biomass cooking is a top-priority switch', () => {
  const plan = planFor(80, { cooking: 'biomass' });
  assert.equal(plan.alternative[0].id, 'clean-fuel');
  assert.equal(plan.alternative[0].priority, 1);
  assert.ok(!ids(planFor(80, { cooking: 'induction' })).includes('cooking-vent'));
});

test('best-window advice uses forecast numbers when the gain is meaningful', () => {
  const window = {
    start: '2026-11-24T14:00',
    worstStart: '2026-11-23T22:00',
    hours: 2,
    best: 60,
    worst: 240,
    reductionPct: 75,
    nextDay: true,
    worstNextDay: false,
  };
  const rec = flattenPlan(planFor(200, {}, window)).find((r) => r.id === 'best-window');
  assert.equal(rec.params.range, '14:00–16:00');
  assert.equal(rec.params.pct, 75);
  assert.equal(rec.params.nextDay, true);

  const flat = { ...window, reductionPct: 5 };
  assert.ok(!ids(planFor(200, {}, flat)).includes('best-window'), 'tiny gains are not worth a card');
});

test('every group is sorted by priority and capped', () => {
  const plan = planFor(420, {
    children: true,
    elderly: true,
    respiratory: true,
    pregnant: true,
    commute: 'car',
    cooking: 'biomass',
    outdoorExercise: true,
  });
  for (const category of CATEGORIES) {
    const list = plan[category];
    assert.ok(list.length <= MAX_PER_CATEGORY, `${category} capped`);
    for (let i = 1; i < list.length; i += 1) assert.ok(list[i - 1].priority <= list[i].priority, `${category} sorted`);
  }
});

test('rules only produce known advice ids', () => {
  const profiles = [
    {},
    { commute: 'car', cooking: 'biomass', outdoorExercise: true, purifier: true },
    { commute: 'two_wheeler', children: true },
    { commute: 'walk_cycle', respiratory: true, cooking: 'lpg' },
  ];
  for (const aqi of [0, 40, 75, 125, 175, 250, 400]) {
    for (const profile of profiles) {
      for (const id of ids(planFor(aqi, profile))) assert.ok(ADVICE_IDS.includes(id), `unknown id ${id}`);
    }
  }
});
