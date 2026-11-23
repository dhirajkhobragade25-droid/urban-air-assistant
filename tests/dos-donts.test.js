import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, buildDosDonts, DO_IDS, DONT_IDS, MAX_DD } from '../js/advice.js';
import { keysFor, createTranslator } from '../js/i18n.js';
import { localAnswer, buildUserPrompt, detectIntent } from '../js/assistant.js';
import { buildPlan } from '../js/advice.js';

const dd = (aqi, profile = {}, window = null) => buildDosDonts(buildContext({ aqi, profile, window }));
const ids = (list) => list.map((item) => item.id);

test('clean air: get outside, nothing scary', () => {
  const { dos, donts } = dd(30);
  assert.ok(ids(dos).includes('walk-cycle'));
  assert.ok(ids(dos).includes('air-out'));
  assert.equal(donts[0].id, 'miss-out');
  assert.ok(!ids(dos).includes('n95'));
  assert.ok(!ids(donts).includes('hard-exercise'));
});

test('hazardous air: stay in, get help, no travel', () => {
  const { dos, donts } = dd(420);
  assert.deepEqual(ids(dos).slice(0, 3), ['stay-in', 'see-doctor', 'n95']);
  assert.equal(donts[0].id, 'travel');
  assert.ok(ids(donts).includes('hard-exercise'));
  assert.ok(ids(donts).includes('kids-out'));
});

test('profile changes the lists', () => {
  assert.ok(ids(dd(120, { respiratory: true }).dos).includes('meds'));
  assert.ok(!ids(dd(120).dos).includes('meds'));
  assert.ok(ids(dd(120, { children: true }).donts).includes('kids-out'));
  assert.ok(!ids(dd(120).donts).includes('kids-out'));
  assert.ok(ids(dd(80, { commute: 'car' }).dos).includes('transit'));
  assert.ok(ids(dd(30, { commute: 'car' }).donts).includes('idle'));
  assert.ok(!ids(dd(30, { cooking: 'induction' }).dos).includes('chimney'));
});

test('cleanest hours appear only with a useful forecast window', () => {
  const window = { start: '2026-11-24T14:00', worstStart: '2026-11-23T22:00', hours: 2, best: 60, worst: 240, reductionPct: 75, nextDay: true, worstNextDay: false };
  const item = dd(180, {}, window).dos.find((d) => d.id === 'best-hours');
  assert.deepEqual(item.params, { range: '14:00–16:00', nextDay: true });
  assert.equal(createTranslator('en')('do.best-hours', item.params), 'Plan errands for 14:00–16:00 (tomorrow), the cleanest hours');
  assert.ok(!ids(dd(180, {}, { ...window, reductionPct: 3 }).dos).includes('best-hours'));
});

test('lists are capped and every id is translated in both languages', () => {
  const full = dd(260, { children: true, respiratory: true, commute: 'car', cooking: 'lpg' });
  assert.ok(full.dos.length <= MAX_DD && full.donts.length <= MAX_DD);
  for (const lang of ['en', 'hi']) {
    const keys = new Set(keysFor(lang));
    for (const id of DO_IDS) assert.ok(keys.has(`do.${id}`), `${lang} do.${id}`);
    for (const id of DONT_IDS) assert.ok(keys.has(`dont.${id}`), `${lang} dont.${id}`);
  }
});

test('chat answers "what should I avoid" with do and don\'t lists', () => {
  assert.equal(detectIntent('What should I avoid today?'), 'dosdonts');
  assert.equal(detectIntent('आज किन चीज़ों से बचूँ?'), 'dosdonts');
  assert.equal(detectIntent('Do I need a mask?'), 'mask', 'more specific intents win');

  const ctx = buildContext({ aqi: 260, profile: { children: true } });
  const answer = localAnswer({
    question: 'What should I avoid today?', plan: buildPlan(ctx), risk: ctx.risk, translate: createTranslator('en'), dosDonts: buildDosDonts(ctx),
  });
  assert.match(answer, /Do:/);
  assert.match(answer, /❌ Don’t run, cycle hard or play sports outdoors/);
  assert.equal(answer.split('\n').filter((l) => l.startsWith('✅')).length, 3);
});

test('Gemini prompt includes the do and don\'t lists', () => {
  const ctx = buildContext({ aqi: 200, profile: {} });
  const prompt = buildUserPrompt({
    question: 'hi', place: 'Delhi', snapshot: null, risk: ctx.risk, profile: ctx.profile,
    plan: buildPlan(ctx), dosDonts: buildDosDonts(ctx), translate: createTranslator('en'),
  });
  assert.match(prompt, /"dosAndDonts":\{"do":\[/);
  assert.match(prompt, /Don’t keep windows open in smoggy hours/);
});
