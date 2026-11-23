import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAirClient, CACHE_TTL_MS } from '../js/api.js';

const airBody = {
  current: { time: '2026-11-23T21:00', us_aqi: 180, pm2_5: 95, pm10: 140, nitrogen_dioxide: 40, ozone: 12 },
  hourly: { time: ['2026-11-23T22:00'], pm2_5: [90], us_aqi: [175] },
};

function recorder(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: status < 400, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

test('fetchAirQuality builds the Open-Meteo request and parses it', async () => {
  const { calls, fetchImpl } = recorder(airBody);
  const client = createAirClient({ fetchImpl });
  const data = await client.fetchAirQuality({ latitude: 28.6139, longitude: 77.209 });
  assert.equal(data.aqi, 180);
  const url = new URL(calls[0]);
  assert.equal(url.hostname, 'air-quality-api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '28.6139');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.match(url.searchParams.get('current'), /us_aqi/);
});

test('fetchAirQuality caches by rounded coordinates for 10 minutes', async () => {
  const { calls, fetchImpl } = recorder(airBody);
  let clock = 0;
  const client = createAirClient({ fetchImpl, now: () => clock });
  await client.fetchAirQuality({ latitude: 28.611, longitude: 77.209 });
  await client.fetchAirQuality({ latitude: 28.612, longitude: 77.2091 });
  assert.equal(calls.length, 1, 'second call served from cache');
  clock = CACHE_TTL_MS + 1;
  await client.fetchAirQuality({ latitude: 28.611, longitude: 77.209 });
  assert.equal(calls.length, 2, 'cache expires');
});

test('fetchAirQuality validates coordinates and surfaces errors', async () => {
  const { calls, fetchImpl } = recorder(airBody);
  const client = createAirClient({ fetchImpl });
  await assert.rejects(client.fetchAirQuality({ latitude: 120, longitude: 0 }), (e) => e.code === 'badInput');
  assert.equal(calls.length, 0);

  const failing = createAirClient(recorder({}, 503));
  await assert.rejects(failing.fetchAirQuality({ latitude: 1, longitude: 1 }), (e) => e.code === 'http' && e.params.status === 503);

  const empty = createAirClient(recorder({ current: {} }));
  await assert.rejects(empty.fetchAirQuality({ latitude: 1, longitude: 1 }), (e) => e.code === 'noData');

  const offline = createAirClient({ fetchImpl: async () => { throw new TypeError('offline'); } });
  await assert.rejects(offline.fetchAirQuality({ latitude: 1, longitude: 1 }), (e) => e.code === 'network');
});

test('searchPlaces maps results and filters bad entries', async () => {
  const { calls, fetchImpl } = recorder({
    results: [
      { id: 1, name: 'Delhi', admin1: 'Delhi', country: 'India', latitude: 28.65, longitude: 77.23 },
      { id: 2, name: 'Broken', latitude: 'x', longitude: 5 },
    ],
  });
  const client = createAirClient({ fetchImpl });
  const places = await client.searchPlaces('Delhi', 'hi');
  assert.deepEqual(places, [{ id: 1, name: 'Delhi', latitude: 28.65, longitude: 77.23, label: 'Delhi, Delhi, India' }]);
  assert.equal(new URL(calls[0]).searchParams.get('language'), 'hi');
});

test('searchPlaces handles empty results and rejects bad queries', async () => {
  const client = createAirClient(recorder({}));
  assert.deepEqual(await client.searchPlaces('Nowhereville'), []);
  await assert.rejects(client.searchPlaces('a'), (e) => e.code === 'badInput');
  await assert.rejects(client.searchPlaces('x'.repeat(81)), (e) => e.code === 'badInput');
});
