/**
 * The page state shared by the UI modules, the storage areas it is saved in,
 * and the translator for the current language.
 */
import { DEFAULT_PROFILE, normalizeProfile } from '../engine.js';
import { normalizeRoutine } from '../routine.js';
import { createTranslator, resolveLang } from '../i18n.js';
import { DEFAULT_GEMINI_MODEL } from '../assistant.js';
import { DEFAULT_CHARACTER } from '../mascot.js';
import { openStorage } from '../storage.js';

export const local = openStorage('localStorage');
export const session = openStorage('sessionStorage');

export const state = {
  lang: 'en',
  profile: normalizeProfile(DEFAULT_PROFILE),
  routine: normalizeRoutine(null),
  live: null, // { place: {label, labelKey?, latitude, longitude}, snapshot }
  simulatedAqi: null,
  ai: { apiKey: '', model: DEFAULT_GEMINI_MODEL },
  status: { key: '', params: {}, isError: false },
  view: null,
  mood: null,
  character: DEFAULT_CHARACTER,
  phase: 'auto', // 'auto' follows the local time; demo mode can preview any time of day
  screen: 'setup-place', // see flow.js: setup-place → setup-you → main
  editing: false, // true when a setup step was opened from Settings
  setupDone: false,
  demo: false, // demo mode: the only place where AQI and time of day can be set by hand
  lastGauge: null, // {aqi, position} of the ring last drawn, so the next one can glide from it
  quipSeed: 0,
  requestId: 0,
  paused: false,
  frame: 0,
  openGroups: new Map(), // plan category → the user's own open/closed choice
};

let translate = createTranslator(state.lang);

/**
 * Translates a key in the current language.
 * @param {string} key
 * @param {object} [params]
 * @returns {string}
 */
export const T = (key, params) => translate(key, params);

/**
 * Switches the language that T uses.
 * @param {string} lang
 * @returns {string} the language actually used
 */
export function useLang(lang) {
  state.lang = resolveLang(lang);
  translate = createTranslator(state.lang);
  return state.lang;
}

/** Name of a place in the current language. */
export const placeName = (place) => (place.labelKey ? T(place.labelKey) : place.label);
