import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStorage, store, KEYS } from '../js/storage.js';
import { renderMascot } from '../js/mascot.js';
import { formatNumber } from '../js/i18n.js';

function memoryArea() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}
const brokenArea = {
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('quota');
  },
  removeItem() {
    throw new Error('denied');
  },
};

test('openStorage returns a working area, or null when storage is blocked', () => {
  const area = memoryArea();
  assert.equal(openStorage('localStorage', { localStorage: area }), area);
  assert.equal(openStorage('localStorage', { localStorage: brokenArea }), null);
  assert.equal(openStorage('localStorage', {}), null);
});

test('store reads and writes JSON and never throws', () => {
  const area = memoryArea();
  store.set(area, KEYS.profile, { children: true });
  assert.deepEqual(store.get(area, KEYS.profile), { children: true });
  store.remove(area, KEYS.profile);
  assert.equal(store.get(area, KEYS.profile), null);
  area.setItem('bad', '{not json');
  assert.equal(store.get(area, 'bad'), null);
  assert.doesNotThrow(() => store.set(brokenArea, 'k', 1));
  assert.doesNotThrow(() => store.remove(brokenArea, 'k'));
  assert.equal(store.get(brokenArea, 'k'), null);
  assert.equal(store.get(null, 'k'), null);
});

/** Minimal stand-in for the stage element (no DOM needed). */
function fakeStage() {
  const buddies = ['twins', 'cloud', 'tulsi'].map((b) => ({ dataset: { buddy: b }, hidden: false }));
  const titles = [{ textContent: '' }, { textContent: '' }];
  const bubble = { textContent: '' };
  const classes = new Set();
  return {
    dataset: {},
    offsetWidth: 100,
    buddies,
    titles,
    bubble,
    classes,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    querySelector: (sel) => (sel === '[data-role="bubble"]' ? bubble : null),
    querySelectorAll: (sel) => (sel === '[data-buddy]' ? buddies : titles),
  };
}

test('renderMascot shows one buddy, its mood, line and label', () => {
  const stage = fakeStage();
  renderMascot(stage, { character: 'cloud', mood: 'cough', quip: 'cough cough', label: 'Badal: coughing' });
  assert.equal(stage.dataset.mood, 'cough');
  assert.equal(stage.dataset.character, 'cloud');
  assert.deepEqual(
    stage.buddies.map((b) => b.hidden),
    [true, false, true],
  );
  assert.equal(stage.bubble.textContent, 'cough cough');
  assert.ok(stage.titles.every((t) => t.textContent === 'Badal: coughing'));
  assert.ok(stage.classes.has('is-changing'), 'pop animation on change');

  stage.classes.clear();
  renderMascot(stage, { character: 'cloud', mood: 'cough', quip: 'again', label: 'x' });
  assert.ok(!stage.classes.has('is-changing'), 'no pop when nothing changed');

  renderMascot(stage, { character: 'pigeon', mood: 'happy', quip: '', label: '' });
  assert.equal(stage.dataset.character, 'twins', 'unknown buddy falls back to the default');
});

test('formatNumber uses Indian grouping in both languages', () => {
  assert.equal(formatNumber('en', 123456), '1,23,456');
  assert.equal(formatNumber('hi', 2.5), '2.5');
});

test('a mood change glides each figure from its current pose to rest', async () => {
  const { GLIDE_MS, GLIDE_EASING } = await import('../js/mascot.js');
  const calls = [];
  const figure = {
    pose: 'matrix(0.99, -0.12, 0.12, 0.99, 0, 10)',
    animate: (frames, opts) => calls.push({ frames, opts }),
  };
  const resting = { pose: 'none', animate: () => calls.push('should not glide') };
  const stage = fakeStage();
  stage.dataset.mood = 'faint';
  stage.dataset.character = 'twins';
  const baseQuery = stage.querySelectorAll;
  stage.querySelectorAll = (sel) => (sel === '.m-figure, .m-ride' ? [figure, resting] : baseQuery(sel));
  globalThis.getComputedStyle = (node) => ({ transform: node.pose });
  try {
    renderMascot(stage, { character: 'twins', mood: 'happy', quip: 'up again', label: 'x' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].frames, [{ transform: figure.pose }, { transform: 'none' }]);
    assert.deepEqual(calls[0].opts, { duration: GLIDE_MS, easing: GLIDE_EASING });

    calls.length = 0;
    renderMascot(stage, { character: 'twins', mood: 'cough', quip: 'q', label: 'x' }, { smooth: false });
    assert.equal(calls.length, 0, 'no glide when paused or reduced motion');
  } finally {
    delete globalThis.getComputedStyle;
  }
});
