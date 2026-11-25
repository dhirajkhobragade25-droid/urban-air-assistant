/**
 * Which screen is showing (a setup step or the live screen) and the
 * Settings sheet. See flow.js for the order of the steps.
 */
import { $ } from '../dom.js';
import { KEYS, store } from '../storage.js';
import { els } from './elements.js';
import { state, local } from './state.js';
import { lenses, setActiveTab } from './lenses.js';
import { render } from './render.js';

const HEADINGS = Object.freeze({
  'setup-place': '#loc-heading',
  'setup-you': '#profile-heading',
  'main': '#air-heading',
});

/**
 * Shows one screen: a setup step (first run, or opened from Settings with
 * `editing`) or the live main screen.
 * @param {'setup-place'|'setup-you'|'main'} screen
 * @param {{editing?: boolean, focus?: boolean}} [options]
 */
export function showScreen(screen, { editing = state.editing, focus = false } = {}) {
  const main = screen === 'main';
  state.screen = screen;
  state.editing = main ? false : editing;
  document.body.dataset.screen = screen;
  els.setup.hidden = main;
  els.secPlace.hidden = screen !== 'setup-place';
  els.secYou.hidden = screen !== 'setup-you';
  els.home.hidden = !main;
  els.tabbar.hidden = !main;
  els.placeCancel.hidden = !state.editing;
  els.demoStart.hidden = state.editing; // demo lives in Settings once set up
  els.youBack.hidden = state.editing;
  document.querySelectorAll('.setup .step').forEach((node) => {
    node.hidden = state.editing;
  });
  window.scrollTo(0, 0);
  if (main) {
    setActiveTab('sec-air', false);
    lenses.phase.update(false);
  }
  if (focus) $(HEADINGS[screen])?.focus({ preventScroll: true });
}

/** Ends the first-run setup and opens the live screen. */
export function finishSetup() {
  state.setupDone = true;
  store.set(local, KEYS.setup, { done: true });
  showScreen('main', { focus: true });
}

/** Opens a setup step from anywhere (Settings, or the empty scene). */
export function editStep(screen) {
  if (els.settings.open) els.settings.close();
  showScreen(screen, { editing: state.setupDone, focus: true });
}

/** Opens the Settings sheet as a modal dialog. */
export function openSettings() {
  render();
  if (typeof els.settings.showModal === 'function') els.settings.showModal();
  else els.settings.setAttribute('open', '');
  lenses.langSettings.update(false);
}

/** Closes the Settings sheet. */
export function closeSettings() {
  if (typeof els.settings.close === 'function') els.settings.close();
  else els.settings.removeAttribute('open');
}
