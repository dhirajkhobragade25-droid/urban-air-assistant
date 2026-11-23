import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, keysFor, createTranslator, localizeParams, resolveLang, LANGS } from '../js/i18n.js';
import { ADVICE_IDS } from '../js/advice.js';
import { MOODS, QUIPS_PER_MOOD, CHARACTERS, DEFAULT_CHARACTER, moodForLevel, quipKey, resolveCharacter } from '../js/mascot.js';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('English and Hindi have exactly the same keys', () => {
  assert.deepEqual(keysFor('hi').sort(), keysFor('en').sort());
});

test('translations use the same placeholders in every language', () => {
  for (const key of keysFor('en')) {
    assert.deepEqual(placeholders(t('hi', key)), placeholders(t('en', key)), key);
  }
});

test('every advice id and mascot line is translated', () => {
  const known = new Set(keysFor('en'));
  for (const id of ADVICE_IDS) {
    for (const part of ['title', 'action', 'why']) assert.ok(known.has(`advice.${id}.${part}`), `${id}.${part}`);
  }
  assert.ok(known.has('advice.wfh-vehicle.why'));
  for (const id of CHARACTERS) assert.ok(known.has(`char.${id}`), id);
  for (const mood of MOODS) {
    assert.ok(known.has(`mood.${mood}`), mood);
    for (let i = 0; i < QUIPS_PER_MOOD; i += 1) assert.ok(known.has(quipKey(mood, i)), quipKey(mood, i));
  }
});

test('t() fills params, falls back safely and never throws', () => {
  assert.equal(t('en', 'air.personal', { label: 'Good' }), 'For you: Good');
  assert.equal(t('xx', 'band.good'), 'Good', 'unknown language → English');
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
  assert.equal(t('en', 'air.personal'), 'For you: {label}', 'missing param left visible');
  assert.equal(resolveLang('hi'), 'hi');
  assert.equal(resolveLang(undefined), 'en');
  assert.deepEqual(LANGS, ['en', 'hi']);
});

test('localizeParams turns day flags into words', () => {
  assert.equal(localizeParams('en', { nextDay: true }).day, ' (tomorrow)');
  assert.equal(localizeParams('hi', { nextDay: true }).day, ' (कल)');
  assert.equal(localizeParams('en', { worstNextDay: false }).worstDay, '');
  const tr = createTranslator('en');
  assert.equal(tr('air.best', { range: '14:00–16:00', nextDay: true }), 'Cleanest 2 hours: 14:00–16:00 (tomorrow)');
});

test('mascot mood follows personal risk level', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(moodForLevel), MOODS);
  assert.equal(moodForLevel(-3), 'happy');
  assert.equal(moodForLevel(99), 'faint');
  assert.equal(moodForLevel(NaN), 'happy');
  assert.equal(quipKey('cough', 3), 'quip.cough.1');
  assert.equal(quipKey('nope', 0), 'quip.happy.0');
});

test('buddy choice defaults to Phephde Brothers and rejects unknown ids', () => {
  assert.equal(DEFAULT_CHARACTER, 'twins');
  assert.deepEqual(CHARACTERS, ['twins', 'cloud', 'tulsi']);
  assert.equal(resolveCharacter('cloud'), 'cloud');
  assert.equal(resolveCharacter('pigeon'), 'twins');
  assert.equal(resolveCharacter(null), 'twins');
  assert.equal(createTranslator('hi')('mascot.label', { name: 'तुलसी', mood: 'खाँसते हुए' }), 'तुलसी: खाँसते हुए');
});
