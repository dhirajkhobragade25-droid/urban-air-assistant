/**
 * English and Hindi: the static text in the page and switching between them.
 */
import { KEYS, store } from '../storage.js';
import { state, local, T, useLang } from './state.js';
import { renderStatus } from './status.js';
import { lenses } from './lenses.js';
import { render } from './render.js';
import { renderAiStatus } from './gemini.js';
import { updateMotionButton } from './buddy.js';

/** Picks the saved language, or Hindi when the browser asks for it. */
export function restoreLang() {
  const saved = store.get(local, KEYS.lang);
  const browserHindi = (navigator.language || '').toLowerCase().startsWith('hi');
  useLang(saved || (browserHindi ? 'hi' : 'en'));
}

/** Fills every data-i18n text, placeholder and label in the page. */
export function applyStaticText() {
  document.documentElement.lang = state.lang;
  document.title = T('app.title');
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = T(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = T(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-label]').forEach((node) => {
    const params = node.dataset.i18nActivity ? { activity: T(node.dataset.i18nActivity) } : {};
    node.setAttribute('aria-label', T(node.dataset.i18nLabel, params));
  });
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === state.lang));
  });
  lenses.langHead.update();
  lenses.langSettings.update();
  lenses.tabs.update(false);
  updateMotionButton();
}

/** Switches the whole app to another language and saves the choice. */
export function setLang(lang) {
  store.set(local, KEYS.lang, useLang(lang));
  applyStaticText();
  renderStatus();
  renderAiStatus();
  render();
}
