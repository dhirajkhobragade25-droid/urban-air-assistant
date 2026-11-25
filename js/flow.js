/**
 * App flow: a one-time setup, then the live screen.
 *
 * First run asks for the city, then for the household and its routine.
 * Once that is done the main screen shows only the live air, the plan and
 * the assistant; the setup steps come back only from Settings.
 * Demo mode is a separate switch: it is the only place where anyone can
 * set the AQI or the time of day by hand.
 *
 * Pure functions only; app.js shows and hides the screens.
 */

export const SCREENS = Object.freeze(['setup-place', 'setup-you', 'main']);

/** AQI the demo starts from when there is no live reading to start from. */
export const DEMO_START_AQI = 150;

/** Reads the stored setup flag safely (anything odd counts as not done). */
export function normalizeSetup(raw) {
  return { done: Boolean(raw && typeof raw === 'object' && raw.done === true) };
}

/** Which screen opens when the app starts. */
export function startScreen({ setupDone, hasPlace }) {
  if (setupDone) return 'main';
  return hasPlace ? 'setup-you' : 'setup-place';
}

/** Where to go once a city's air has loaded on the city step. */
export function afterPlace({ setupDone, editing }) {
  return setupDone || editing ? 'main' : 'setup-you';
}

/** Step number shown on a setup screen ("Step 1 of 2"), or null outside setup. */
export function stepOf(screen) {
  const index = ['setup-place', 'setup-you'].indexOf(screen);
  return index === -1 ? null : index + 1;
}

/** The AQI a demo opens on: the live reading if there is one, else a smoggy default. */
export function demoStartAqi(liveAqi) {
  const n = typeof liveAqi === 'number' ? liveAqi : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 500) : DEMO_START_AQI;
}

/** First word of a place label, for the small city name on the scene ("Delhi, Delhi, India" → "Delhi"). */
export function shortPlace(label) {
  const text = String(label ?? '').trim();
  return text.split(',')[0].trim() || text;
}

const inRange = (n, limit) => Number.isFinite(n) && Math.abs(n) <= limit;

/** What gets saved for a place: a named city, or "my location" from GPS. */
export function placeToStore(place) {
  const base = { latitude: Number(place.latitude), longitude: Number(place.longitude) };
  return place.labelKey ? { labelKey: 'loc.myLocation', ...base } : { label: String(place.label), ...base };
}

/** Reads a saved place back, or null if it is missing or looks wrong. */
export function restorePlace(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (!inRange(latitude, 90) || !inRange(longitude, 180)) return null;
  if (raw.labelKey === 'loc.myLocation') return { labelKey: 'loc.myLocation', latitude, longitude };
  if (typeof raw.label === 'string' && raw.label.trim() && raw.label.length <= 160) return { label: raw.label.trim(), latitude, longitude };
  return null;
}
