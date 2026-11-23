/**
 * Core decision logic for the Urban Air Quality Assistant.
 *
 * Everything in this module is pure (no DOM, no network) so it can be
 * unit-tested with Node's built-in test runner and reused by the UI.
 */

/** US EPA AQI bands (0–500 scale). `max` is inclusive. */
export const AQI_BANDS = Object.freeze([
  Object.freeze({ key: 'good', max: 50 }),
  Object.freeze({ key: 'moderate', max: 100 }),
  Object.freeze({ key: 'sensitive', max: 150 }),
  Object.freeze({ key: 'unhealthy', max: 200 }),
  Object.freeze({ key: 'very-unhealthy', max: 300 }),
  Object.freeze({ key: 'hazardous', max: Infinity }),
]);

export const MAX_LEVEL = AQI_BANDS.length - 1;

/** WHO 2021 air-quality guideline for 24-hour mean PM2.5, in µg/m³. */
export const WHO_PM25_24H = 15;

export const COMMUTE_MODES = Object.freeze(['car', 'two_wheeler', 'public', 'walk_cycle', 'wfh']);
export const COOKING_FUELS = Object.freeze(['lpg', 'induction', 'biomass']);

/**
 * Approximate tailpipe CO₂ per passenger-km (kg). These are rounded,
 * conservative averages used only to explain the *scale* of a choice.
 * See README → "Assumptions".
 */
export const EMISSION_KG_CO2_PER_KM = Object.freeze({
  car: 0.17,
  two_wheeler: 0.05,
  public: 0.03,
  walk_cycle: 0,
  wfh: 0,
});

export const DEFAULT_PROFILE = Object.freeze({
  children: false,
  elderly: false,
  respiratory: false,
  pregnant: false,
  commute: 'public',
  commuteKm: 10,
  cooking: 'lpg',
  purifier: false,
  outdoorExercise: false,
});

const MAX_AQI = 1000;
const MAX_COMMUTE_KM = 200;

/** Throws a RangeError unless `aqi` is a finite number in [0, 1000]. */
export function assertAqi(aqi) {
  if (typeof aqi !== 'number' || !Number.isFinite(aqi) || aqi < 0 || aqi > MAX_AQI) {
    throw new RangeError(`AQI must be a number between 0 and ${MAX_AQI}`);
  }
}

/** Index (0–5) of the AQI band that contains `aqi`. */
export function bandIndex(aqi) {
  assertAqi(aqi);
  return AQI_BANDS.findIndex((band) => aqi <= band.max);
}

/** The AQI band object that contains `aqi`. */
export function categorize(aqi) {
  return AQI_BANDS[bandIndex(aqi)];
}

/**
 * Returns a clean profile containing only known keys with valid values.
 * Unknown keys are dropped, so user input can never inject extra fields.
 */
export function normalizeProfile(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const km = Number(source.commuteKm);
  return {
    children: source.children === true,
    elderly: source.elderly === true,
    respiratory: source.respiratory === true,
    pregnant: source.pregnant === true,
    commute: COMMUTE_MODES.includes(source.commute) ? source.commute : DEFAULT_PROFILE.commute,
    commuteKm: Number.isFinite(km) ? Math.min(Math.max(km, 0), MAX_COMMUTE_KM) : DEFAULT_PROFILE.commuteKm,
    cooking: COOKING_FUELS.includes(source.cooking) ? source.cooking : DEFAULT_PROFILE.cooking,
    purifier: source.purifier === true,
    outdoorExercise: source.outdoorExercise === true,
  };
}

/** True when anyone in the household belongs to a sensitive group. */
export function isSensitive(profile) {
  const p = normalizeProfile(profile);
  return p.children || p.elderly || p.respiratory || p.pregnant;
}

/**
 * Personalised risk. The outdoor band is raised one level for sensitive
 * households once air is no longer "good", and one more level for people
 * with a lung or heart condition once AQI passes 100.
 */
export function assessRisk(aqi, profile) {
  const p = normalizeProfile(profile);
  const base = bandIndex(aqi);
  let level = base;
  if (isSensitive(p) && aqi > AQI_BANDS[0].max) level += 1;
  if (p.respiratory && aqi > AQI_BANDS[1].max) level += 1;
  level = Math.min(level, MAX_LEVEL);
  return {
    aqi,
    baseLevel: base,
    band: AQI_BANDS[base],
    level,
    personal: AQI_BANDS[level],
    raised: level > base,
    sensitive: isSensitive(p),
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * CO₂ avoided per week (kg) by moving trips from one mode to another.
 * @param {{km:number, from:string, to:string, daysPerWeek?:number, tripsPerDay?:number}} options
 */
export function weeklyCo2SavedKg({ km, from, to, daysPerWeek = 5, tripsPerDay = 2 }) {
  const fromFactor = EMISSION_KG_CO2_PER_KM[from];
  const toFactor = EMISSION_KG_CO2_PER_KM[to];
  if (fromFactor === undefined || toFactor === undefined) {
    throw new RangeError('Unknown commute mode');
  }
  if (![km, daysPerWeek, tripsPerDay].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new RangeError('Distance and frequency must be non-negative numbers');
  }
  return round1(Math.max(0, (fromFactor - toFactor) * km * tripsPerDay * daysPerWeek));
}

/** How many times the WHO 24-hour PM2.5 guideline a reading is (1 decimal). */
export function whoMultiple(pm25) {
  if (!Number.isFinite(pm25) || pm25 < 0) return null;
  return round1(pm25 / WHO_PM25_24H);
}

/** "HH:00–HH:00" for a window that starts at an ISO local time. */
export function formatRange(isoTime, hours) {
  const start = Number.parseInt(String(isoTime).slice(11, 13), 10);
  if (!Number.isInteger(start)) return '';
  const end = (start + hours) % 24;
  const pad = (h) => `${String(h).padStart(2, '0')}:00`;
  return `${pad(start)}–${pad(end)}`;
}

/**
 * Finds the cleanest and dirtiest consecutive windows in the hourly
 * PM2.5 forecast, starting from `fromTime` (ISO local time, same zone).
 * Windows containing missing data are skipped.
 * @returns {null | {start:string, worstStart:string, hours:number, best:number,
 *   worst:number, reductionPct:number, nextDay:boolean, worstNextDay:boolean}}
 */
export function findBestWindow(hourly, fromTime, { windowHours = 2, horizonHours = 24 } = {}) {
  if (!Array.isArray(hourly) || typeof fromTime !== 'string') return null;
  const upcoming = hourly.filter((h) => h && typeof h.time === 'string' && h.time >= fromTime).slice(0, horizonHours);

  let best = null;
  let worst = null;
  for (let i = 0; i + windowHours <= upcoming.length; i += 1) {
    const slice = upcoming.slice(i, i + windowHours);
    if (!slice.every((h) => Number.isFinite(h.pm25))) continue;
    const avg = slice.reduce((sum, h) => sum + h.pm25, 0) / windowHours;
    if (!best || avg < best.avg) best = { avg, start: slice[0].time };
    if (!worst || avg > worst.avg) worst = { avg, start: slice[0].time };
  }
  if (!best) return null;

  const today = fromTime.slice(0, 10);
  return {
    start: best.start,
    worstStart: worst.start,
    hours: windowHours,
    best: Math.round(best.avg),
    worst: Math.round(worst.avg),
    reductionPct: worst.avg > 0 ? Math.round(((worst.avg - best.avg) / worst.avg) * 100) : 0,
    nextDay: best.start.slice(0, 10) !== today,
    worstNextDay: worst.start.slice(0, 10) !== today,
  };
}

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Validates and reshapes an Open-Meteo air-quality response.
 * Throws if the current US AQI is missing.
 */
export function parseAirQuality(json) {
  const current = json && json.current;
  if (!current || typeof current.time !== 'string' || numOrNull(current.us_aqi) === null) {
    const error = new Error('No air-quality data for this location');
    error.code = 'noData';
    throw error;
  }
  const hourly = json.hourly && Array.isArray(json.hourly.time)
    ? json.hourly.time.map((time, i) => ({
      time,
      pm25: numOrNull(json.hourly.pm2_5 && json.hourly.pm2_5[i]),
      aqi: numOrNull(json.hourly.us_aqi && json.hourly.us_aqi[i]),
    }))
    : [];
  return {
    time: current.time,
    aqi: Math.min(Math.max(Math.round(current.us_aqi), 0), MAX_AQI),
    pm25: numOrNull(current.pm2_5),
    pm10: numOrNull(current.pm10),
    no2: numOrNull(current.nitrogen_dioxide),
    o3: numOrNull(current.ozone),
    hourly,
  };
}
