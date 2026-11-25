/**
 * Open-Meteo clients (geocoding + air quality). No API key is needed.
 * Results are cached in memory for 10 minutes to avoid repeat requests.
 */
import { parseAirQuality } from './engine.js';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const TIMEOUT_MS = 12000;
export const CACHE_TTL_MS = 10 * 60 * 1000;

/** Error with a stable `code` the UI can translate. */
export class ApiError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.params = params;
  }
}

const isLatitude = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const isLongitude = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

/** GETs JSON with a timeout, turning every failure into an ApiError. */
async function getJson(fetchImpl, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new ApiError('http', { status: response.status });
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error?.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** A geocoding result as the app's place, with a readable label. */
function toPlace(r) {
  return {
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
  };
}

/** The air-quality request for a coordinate: current values plus 2 days of hourly PM2.5. */
function airQualityUrl(latitude, longitude) {
  const url = new URL(AIR_URL);
  url.search = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
    hourly: 'pm2_5,us_aqi',
    timezone: 'auto',
    forecast_days: '2',
  });
  return url.toString();
}

/**
 * Creates a client. Dependencies are injectable for testing.
 * @param {{fetchImpl?: Function, now?: () => number}} deps
 */
export function createAirClient({ fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now() } = {}) {
  const cache = new Map();

  /** Finds up to 5 places matching `name`. */
  async function searchPlaces(name, lang = 'en') {
    const query = String(name ?? '').trim();
    if (query.length < 2 || query.length > 80) throw new ApiError('badInput');
    const url = new URL(GEOCODE_URL);
    url.search = new URLSearchParams({
      name: query,
      count: '5',
      language: lang === 'hi' ? 'hi' : 'en',
      format: 'json',
    });
    const json = await getJson(fetchImpl, url.toString());
    const results = Array.isArray(json?.results) ? json.results : [];
    return results
      .filter((r) => isLatitude(r.latitude) && isLongitude(r.longitude) && typeof r.name === 'string')
      .map(toPlace);
  }

  /** Current air quality + 2-day hourly PM2.5 for a coordinate. */
  async function fetchAirQuality({ latitude, longitude }) {
    if (!isLatitude(latitude) || !isLongitude(longitude)) throw new ApiError('badInput');
    const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.data;

    let data;
    try {
      data = parseAirQuality(await getJson(fetchImpl, airQualityUrl(latitude, longitude)));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(error.code || 'noData');
    }
    cache.set(key, { at: now(), data });
    return data;
  }

  return { searchPlaces, fetchAirQuality };
}
