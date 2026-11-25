/**
 * Daily-routine re-planner.
 *
 * Takes the household's usual outdoor activities and their times, looks at
 * the hourly PM2.5 forecast, and for each activity decides whether to keep
 * the time, move it to a cleaner hour nearby, or take it indoors. The impact
 * is reported as the % less PM2.5 breathed in during that activity: for the
 * same duration and effort, inhaled dose scales with concentration.
 *
 * Pure functions only, so everything here is unit-tested.
 */
import { weeklyCo2SavedKg } from './engine.js';

/**
 * Activities a family can add to its day.
 * `window` is the range of start hours that still make sense for it, and
 * `effort` decides how strict we are: hard breathing (active) vs light.
 */
export const ACTIVITIES = Object.freeze([
  Object.freeze({ id: 'outdoor-exercise', defaultHour: null, window: [5, 21], effort: 'active' }),
  Object.freeze({ id: 'school-run', defaultHour: null, window: [7, 9], effort: 'light' }),
  Object.freeze({ id: 'commute', defaultHour: 9, window: [7, 11], effort: 'light' }),
  Object.freeze({ id: 'errands', defaultHour: 11, window: [8, 20], effort: 'light' }),
  Object.freeze({ id: 'kids-play', defaultHour: null, window: [15, 19], effort: 'active' }),
  Object.freeze({ id: 'evening-walk', defaultHour: 19, window: [16, 21], effort: 'active' }),
]);

export const ACTIVITY_IDS = Object.freeze(ACTIVITIES.map((a) => a.id));

/** Hour → activity id map; `null` means "not part of our day". */
export const DEFAULT_ROUTINE = Object.freeze(Object.fromEntries(ACTIVITIES.map((a) => [a.id, a.defaultHour])));

/** Hours offered in the time pickers. */
export const ROUTINE_HOURS = Object.freeze(Array.from({ length: 18 }, (_, i) => i + 5)); // 05:00–22:00

/** PM2.5 (µg/m³) at the top of the US AQI "Unhealthy for sensitive groups" band (AQI 150). */
export const PM25_UNHEALTHY = 55.5;
/** PM2.5 (µg/m³) at the top of the "Moderate" band (AQI 100). */
export const PM25_SENSITIVE = 35.5;
/** Only suggest a new time when it cuts PM2.5 by at least this much. */
export const MIN_GAIN_PCT = 15;

const HORIZON_HOURS = 24;

/** "08:00" for 8. */
export function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

const hourOf = (isoTime) => Number.parseInt(isoTime.slice(11, 13), 10);
const isHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;

/**
 * Returns a clean routine with every known activity: a valid hour or null.
 * Missing activities get their default; unknown keys are dropped.
 */
export function normalizeRoutine(input) {
  const source = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(
    ACTIVITIES.map((a) => {
      if (!Object.hasOwn(source, a.id)) return [a.id, a.defaultHour];
      const value = source[a.id];
      if (value === null) return [a.id, null];
      const hour = Number(value);
      return [a.id, isHour(hour) ? hour : a.defaultHour];
    }),
  );
}

/** Advice for one activity when only the overall AQI is known (no forecast). */
function assessWithoutForecast(activity, hour, aqi) {
  let status = 'keep';
  let note = null;
  if (aqi > 150) {
    if (activity.effort === 'active') status = 'indoors';
    else note = 'mask';
  } else if (aqi > 100) {
    note = activity.effort === 'active' ? 'easy' : 'mask';
  }
  return {
    id: activity.id,
    effort: activity.effort,
    hour,
    status,
    note,
    live: false,
    pm25: null,
    bestHour: null,
    bestPm25: null,
    reductionPct: 0,
    nextDay: false,
  };
}

/** The next 24 hours of forecast that have a PM2.5 value. */
function upcomingHours(hourly, fromTime) {
  if (!Array.isArray(hourly) || typeof fromTime !== 'string') return [];
  const start = hourly.findIndex((h) => h && typeof h.time === 'string' && h.time >= fromTime);
  if (start < 0) return [];
  return hourly.slice(start, start + HORIZON_HOURS).filter((h) => Number.isFinite(h.pm25));
}

/**
 * Advice for one activity using the hourly forecast. The usual time is its
 * next occurrence (later today, or tomorrow if it has passed); the best time
 * is the cleanest hour in the next 24 h that still fits the activity.
 */
/** The cleanest forecast hour that still fits the activity's window (the usual slot if none is cleaner). */
function cleanestHour(activity, slot, upcoming) {
  const [lo, hi] = activity.window;
  let best = slot;
  for (const h of upcoming) {
    const hh = hourOf(h.time);
    if (hh >= lo && hh <= hi && h.pm25 < best.pm25) best = h;
  }
  return best;
}

/** keep, move or indoors, and an optional note (mask / take it easy). */
function verdict(activity, slot, best, reductionPct) {
  let status = 'keep';
  if (activity.effort === 'active' && best.pm25 >= PM25_UNHEALTHY) status = 'indoors';
  else if (best !== slot && reductionPct >= MIN_GAIN_PCT) status = 'move';
  const goingAt = status === 'move' ? best.pm25 : slot.pm25;
  let note = null;
  if (status !== 'indoors' && goingAt >= PM25_SENSITIVE) note = activity.effort === 'active' ? 'easy' : 'mask';
  return { status, note };
}

function assessWithForecast(activity, hour, upcoming, today) {
  const slot = upcoming.find((h) => hourOf(h.time) === hour);
  if (!slot) return null;
  const best = cleanestHour(activity, slot, upcoming);
  const reductionPct = slot.pm25 > 0 ? Math.round(((slot.pm25 - best.pm25) / slot.pm25) * 100) : 0;
  const { status, note } = verdict(activity, slot, best, reductionPct);

  return {
    id: activity.id,
    effort: activity.effort,
    hour,
    status,
    note,
    live: true,
    pm25: Math.round(slot.pm25),
    bestHour: hourOf(best.time),
    bestPm25: Math.round(best.pm25),
    reductionPct: status === 'move' ? reductionPct : 0,
    nextDay: (status === 'move' ? best : slot).time.slice(0, 10) !== today,
  };
}

/**
 * Re-plans the household's day.
 * @param {{routine:object, aqi:number, hourly?:Array<{time:string, pm25:number|null}>,
 *   fromTime?:string|null, commute?:string}} input
 * @returns {Array<object>} one entry per active activity, ordered by the time to go out
 */
export function planRoutine({ routine, aqi, hourly = [], fromTime = null, commute = 'public' }) {
  const clean = normalizeRoutine(routine);
  const upcoming = upcomingHours(hourly, fromTime);
  const today = typeof fromTime === 'string' ? fromTime.slice(0, 10) : '';
  const items = [];
  for (const activity of ACTIVITIES) {
    const hour = clean[activity.id];
    if (hour === null) continue;
    if (activity.id === 'commute' && commute === 'wfh') continue;
    const live = upcoming.length ? assessWithForecast(activity, hour, upcoming, today) : null;
    items.push(live || assessWithoutForecast(activity, hour, aqi));
  }
  // Order by when the family will actually go out: today first, then tomorrow.
  const when = (item) => (item.nextDay ? 24 : 0) + (item.status === 'move' ? item.bestHour : item.hour);
  return items.sort((a, b) => when(a) - when(b) || a.hour - b.hour);
}

const VEHICLES = ['car', 'two_wheeler'];

/**
 * Headline numbers for "your impact if you follow this plan".
 * @param {{profile:object, routinePlan:Array<object>}} input
 */
export function summarizeImpact({ profile, routinePlan }) {
  const weeklyCo2Kg = VEHICLES.includes(profile.commute)
    ? weeklyCo2SavedKg({ km: profile.commuteKm, from: profile.commute, to: 'public', daysPerWeek: 3 })
    : 0;
  const moved = routinePlan.filter((item) => item.status === 'move');
  const avgReductionPct = moved.length
    ? Math.round(moved.reduce((sum, item) => sum + item.reductionPct, 0) / moved.length)
    : 0;
  return {
    weeklyCo2Kg,
    movedCount: moved.length,
    avgReductionPct,
    indoorsCount: routinePlan.filter((item) => item.status === 'indoors').length,
  };
}

/**
 * Turns one planned activity into display strings.
 * @param {object} item an entry from planRoutine()
 * @param {(key:string, params?:object) => string} translate
 * @returns {{name:string, tag:string, text:string, note:string|null}}
 */
export function describeRoutineItem(item, translate) {
  const params = {
    time: formatHour(item.hour),
    best: item.bestHour === null ? '' : formatHour(item.bestHour),
    pm: item.pm25,
    bestPm: item.bestPm25,
    pct: item.reductionPct,
    nextDay: item.nextDay,
  };
  let key = `day.${item.status}`;
  if (!item.live && item.status !== 'move') key += 'Sim';
  return {
    name: translate(`act.${item.id}`),
    tag: translate(`day.tag.${item.status}`),
    text: translate(key, params),
    note: item.note ? translate(`day.note.${item.note}`) : null,
  };
}
