/**
 * Translation: English and Hindi strings live in js/locales/. Placeholders use
 * {name} and are filled by t(). Both tables must have identical keys and
 * placeholders (checked in tests).
 */
import { en } from './locales/en.js';
import { hi } from './locales/hi.js';

export const LANGS = Object.freeze(['en', 'hi']);
export const DEFAULT_LANG = 'en';

const TABLES = Object.freeze({ en, hi });

/** Normalises any value to a supported language code. */
export function resolveLang(lang) {
  return LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

/**
 * Translate `key` into `lang`, filling {placeholders} from `params`.
 * Falls back to English, then to the key itself.
 */
export function t(lang, key, params = {}) {
  const table = TABLES[resolveLang(lang)];
  const raw = Object.hasOwn(table, key) ? table[key] : TABLES.en[key];
  if (raw === undefined) return key;
  return raw.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/**
 * Turns language-neutral params from the rules into display params,
 * e.g. `nextDay: true` → `day: " (tomorrow)"`.
 */
export function localizeParams(lang, params = {}) {
  const out = { ...params };
  if ('nextDay' in params) out.day = params.nextDay ? t(lang, 'common.tomorrow') : '';
  if ('worstNextDay' in params) out.worstDay = params.worstNextDay ? t(lang, 'common.tomorrow') : '';
  return out;
}

/** A `(key, params) => string` function bound to one language. */
export function createTranslator(lang) {
  const code = resolveLang(lang);
  return (key, params = {}) => t(code, key, localizeParams(code, params));
}

/** Keys defined for a language (used by tests). */
export function keysFor(lang) {
  return Object.keys(TABLES[resolveLang(lang)]);
}

/**
 * A clock time for editorial copy: "4 PM" in English, "शाम 4 बजे" in Hindi.
 * @param {string} lang
 * @param {number} hour 0–23
 */
export function formatClock(lang, hour) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  if (resolveLang(lang) !== 'hi') return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
  let part = 'रात';
  if (hour >= 4 && hour < 12) part = 'सुबह';
  else if (hour >= 12 && hour < 16) part = 'दोपहर';
  else if (hour >= 16 && hour < 20) part = 'शाम';
  return `${part} ${h12} बजे`;
}

/** Locale-aware number formatting. */
export function formatNumber(lang, value, options = {}) {
  return new Intl.NumberFormat(resolveLang(lang) === 'hi' ? 'hi-IN' : 'en-IN', options).format(value);
}
