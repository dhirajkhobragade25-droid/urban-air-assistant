import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCREENS, DEMO_START_AQI, normalizeSetup, startScreen, afterPlace, stepOf, demoStartAqi, shortPlace,
  placeToStore, restorePlace,
} from '../js/flow.js';

test('first run asks for the city, then the household; after that the app opens on live air', () => {
  assert.equal(startScreen({ setupDone: false, hasPlace: false }), 'setup-place');
  assert.equal(startScreen({ setupDone: false, hasPlace: true }), 'setup-you');
  assert.equal(startScreen({ setupDone: true, hasPlace: true }), 'main');
  assert.equal(startScreen({ setupDone: true, hasPlace: false }), 'main');
  assert.deepEqual([...SCREENS], ['setup-place', 'setup-you', 'main']);
});

test('choosing a city moves on to the household step only during first setup', () => {
  assert.equal(afterPlace({ setupDone: false, editing: false }), 'setup-you');
  assert.equal(afterPlace({ setupDone: true, editing: false }), 'main');
  assert.equal(afterPlace({ setupDone: false, editing: true }), 'main');
});

test('step numbers appear only on setup screens', () => {
  assert.equal(stepOf('setup-place'), 1);
  assert.equal(stepOf('setup-you'), 2);
  assert.equal(stepOf('main'), null);
});

test('the saved setup flag accepts only an explicit done: true', () => {
  assert.deepEqual(normalizeSetup({ done: true }), { done: true });
  for (const raw of [null, undefined, 'done', { done: 'true' }, { done: 1 }, [], 7]) {
    assert.deepEqual(normalizeSetup(raw), { done: false }, JSON.stringify(raw));
  }
});

test('demo starts from the live reading, or from a smoggy default without one', () => {
  assert.equal(demoStartAqi(312), 312);
  assert.equal(demoStartAqi(87.6), 88);
  assert.equal(demoStartAqi(640), 500);
  assert.equal(demoStartAqi(null), DEMO_START_AQI);
  assert.equal(demoStartAqi(-5), DEMO_START_AQI);
  assert.equal(demoStartAqi('x'), DEMO_START_AQI);
  assert.equal(demoStartAqi('200'), DEMO_START_AQI);
  assert.equal(demoStartAqi(0), 0);
});

test('the scene shows just the city name', () => {
  assert.equal(shortPlace('Delhi, Delhi, India'), 'Delhi');
  assert.equal(shortPlace('  Kolkata '), 'Kolkata');
  assert.equal(shortPlace('Your location'), 'Your location');
  assert.equal(shortPlace(null), '');
});

test('places round-trip through storage; GPS is saved as "my location", not a name', () => {
  const city = { label: 'Delhi, Delhi, India', latitude: 28.6, longitude: 77.2 };
  assert.deepEqual(restorePlace(placeToStore(city)), city);
  const gps = { labelKey: 'loc.myLocation', latitude: 22.57, longitude: 88.36, extra: 'dropped' };
  assert.deepEqual(placeToStore(gps), { labelKey: 'loc.myLocation', latitude: 22.57, longitude: 88.36 });
  assert.deepEqual(restorePlace(placeToStore(gps)), { labelKey: 'loc.myLocation', latitude: 22.57, longitude: 88.36 });
});

test('a damaged or tampered saved place is ignored', () => {
  for (const raw of [
    null, 'Delhi', {}, { label: 'X', latitude: 95, longitude: 10 }, { label: 'X', latitude: 10, longitude: -181 },
    { label: '', latitude: 1, longitude: 1 }, { label: 'x'.repeat(200), latitude: 1, longitude: 1 },
    { labelKey: 'evil.key', latitude: 1, longitude: 1 }, { label: 'X', latitude: 'a', longitude: 1 },
  ]) {
    assert.equal(restorePlace(raw), null, JSON.stringify(raw));
  }
  assert.deepEqual(restorePlace({ label: ' Pune ', latitude: '18.5', longitude: '73.8' }), { label: 'Pune', latitude: 18.5, longitude: 73.8 });
});
