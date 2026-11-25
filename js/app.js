/**
 * Entry point: restores the saved settings, wires the events and shows the
 * first screen. Each part of the page has its own module in js/ui/, and every
 * decision lives in the pure, unit-tested modules in js/.
 */
import { startScreen, normalizeSetup, shortPlace, restorePlace } from './flow.js';
import { enablePress } from './press.js';
import { prefersReducedMotion } from './dom.js';
import { KEYS, store } from './storage.js';
import { els } from './ui/elements.js';
import { state, local } from './ui/state.js';
import { goToSection, watchSections } from './ui/lenses.js';
import { render, onPlanSummaryClick } from './ui/render.js';
import { showScreen, finishSetup, editStep, openSettings, closeSettings } from './ui/screens.js';
import { loadPlace, withLocating, onSearch, onPlaceChoice, onGps, onQuickCity } from './ui/location.js';
import { setDemo, onSimulate, onPhaseChange } from './ui/demo.js';
import { restoreHousehold, onProfileChange } from './ui/household.js';
import { renderAiStatus, restoreAi, onAiSave, onAiClear } from './ui/gemini.js';
import { onAsk, onChatKeydown, onExample } from './ui/chat.js';
import { restoreBuddy, onBuddyChange, toggleMotion } from './ui/buddy.js';
import { restoreLang, applyStaticText, setLang } from './ui/language.js';

/** Tab bar: Settings opens the sheet, the other tabs scroll to their section. */
function onTabClick(event) {
  const tab = event.target.closest('.tab');
  if (tab === els.tabSettings) {
    openSettings();
    return;
  }
  const section = tab && document.getElementById(tab.dataset.section);
  if (!section) return;
  event.preventDefault();
  goToSection(section);
}

function bindSetup() {
  els.searchForm.addEventListener('submit', onSearch);
  els.placeList.addEventListener('click', onPlaceChoice);
  els.gpsBtn.addEventListener('click', onGps);
  els.quickCities.addEventListener('click', onQuickCity);
  els.demoStart.addEventListener('click', () => {
    setDemo(true);
    showScreen('main', { focus: true });
  });
  els.placeCancel.addEventListener('click', () => showScreen('main', { focus: true }));
  els.profileForm.addEventListener('change', onProfileChange);
  els.profileForm.addEventListener('submit', (event) => event.preventDefault());
  els.youBack.addEventListener('click', () => showScreen('setup-place', { focus: true }));
  els.youDone.addEventListener('click', finishSetup);
}

function bindMain() {
  els.stage.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="choose-city"]')) editStep('setup-place');
  });
  els.motionBtn.addEventListener('click', toggleMotion);
  els.simRange.addEventListener('input', onSimulate);
  els.demoExit.addEventListener('click', () => setDemo(false));
  els.phasePicker.addEventListener('change', onPhaseChange);
  els.plan.addEventListener('click', onPlanSummaryClick);
  els.chatForm.addEventListener('submit', onAsk);
  els.chatInput.addEventListener('keydown', onChatKeydown);
  els.examples.addEventListener('click', onExample);
  els.tabbar.addEventListener('click', onTabClick);
}

function bindSettings() {
  els.setCity.addEventListener('click', () => editStep('setup-place'));
  els.setHome.addEventListener('click', () => editStep('setup-you'));
  els.demoToggle.addEventListener('change', () => setDemo(els.demoToggle.checked));
  els.buddyPicker.addEventListener('change', onBuddyChange);
  els.aiForm.addEventListener('submit', onAiSave);
  els.aiClear.addEventListener('click', onAiClear);
  els.settingsDone.addEventListener('click', closeSettings);
  els.settings.addEventListener('click', (event) => {
    if (event.target === els.settings) closeSettings(); // a tap on the dimmed backdrop
  });
  document
    .querySelectorAll('.lang-btn')
    .forEach((btn) => btn.addEventListener('click', () => setLang(btn.dataset.lang)));
}

function init() {
  restoreLang();
  restoreBuddy();
  restoreHousehold();
  restoreAi();
  bindSetup();
  bindMain();
  bindSettings();
  enablePress(document, { reducedMotion: prefersReducedMotion });

  const savedPlace = restorePlace(store.get(local, KEYS.place));
  state.setupDone = normalizeSetup(store.get(local, KEYS.setup)).done;
  showScreen(startScreen({ setupDone: state.setupDone, hasPlace: Boolean(savedPlace) }), { editing: false });
  applyStaticText();
  watchSections();
  renderAiStatus();
  render();

  if (savedPlace) {
    if (savedPlace.label) els.cityInput.value = shortPlace(savedPlace.label);
    withLocating(els.searchBtn, () => loadPlace(savedPlace));
  }
}

init();
