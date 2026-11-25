/**
 * UI controller: owns the page state, listens to events and puts the nodes
 * built by views.js on the page. All decisions live in the pure modules
 * (engine, advice, routine, assistant), which are unit-tested.
 */
import { DEFAULT_PROFILE, normalizeProfile, findBestWindow, categorize } from './engine.js';
import { CATEGORIES, buildContext, buildPlan, buildDosDonts } from './advice.js';
import { ACTIVITY_IDS, ROUTINE_HOURS, normalizeRoutine, planRoutine, summarizeImpact, formatHour } from './routine.js';
import { createTranslator, resolveLang } from './i18n.js';
import { PHASES, phaseForHour, gradeFor } from './grade.js';
import { skyFor, heroGlassFor } from './glass.js';
import { enablePress, enableWipe, createLens } from './press.js';
import {
  startScreen, afterPlace, normalizeSetup, demoStartAqi, shortPlace, placeToStore, restorePlace,
} from './flow.js';
import { createAirClient } from './api.js';
import { moodForLevel, quipKey, renderMascot, resolveCharacter, DEFAULT_CHARACTER } from './mascot.js';
import {
  DEFAULT_GEMINI_MODEL, MAX_QUESTION_LENGTH, askGemini, buildSystemPrompt, buildUserPrompt,
  isValidApiKey, isValidModel, localAnswer, sanitizeQuestion, toPlainLines,
} from './assistant.js';
import { $, el, prefersReducedMotion } from './dom.js';
import { KEYS, openStorage, store } from './storage.js';
import {
  heroNodes, animateGauge, readoutNodes, planGroup, dosDontsSection, dayPlanSection, impactSection,
} from './views.js';

const local = openStorage('localStorage');
const session = openStorage('sessionStorage');

const els = {
  searchForm: $('#search-form'),
  cityInput: $('#city-input'),
  searchBtn: $('#search-form button[type="submit"]'),
  gpsBtn: $('#gps-btn'),
  quickCities: $('.quick-cities'),
  placeResults: $('#place-results'),
  placeList: $('#place-results ul'),
  status: $('#status'),
  stage: $('#stage'),
  heroCopy: $('#hero-copy'),
  motionBtn: $('#motion-btn'),
  buddyPicker: $('.buddy-picker'),
  phasePicker: $('.phase-picker'),
  phaseOptions: $('.phase-options'),
  atmosphere: $('#atmosphere'),
  themeColour: $('meta[name="theme-color"]'),
  langHead: $('#lang-head'),
  langSettings: $('#lang-settings'),
  tabbar: $('#tabbar'),
  tabSettings: $('#tab-settings'),
  setup: $('#setup'),
  home: $('#home'),
  secPlace: $('#sec-place'),
  secYou: $('#sec-you'),
  placeCancel: $('#place-cancel'),
  demoStart: $('#demo-start'),
  setupPreview: $('#setup-preview'),
  youBack: $('#you-back'),
  youDone: $('#you-done'),
  demoPanel: $('#demo-panel'),
  demoExit: $('#demo-exit'),
  demoToggle: $('#demo-toggle'),
  settings: $('#settings'),
  settingsDone: $('#settings-done'),
  setCity: $('#set-city'),
  setCityValue: $('#set-city-value'),
  setHome: $('#set-home'),
  readout: $('#readout'),
  simRange: $('#sim-range'),
  simOutput: $('#sim-output'),
  profileForm: $('#profile-form'),
  plan: $('#plan'),
  chatLog: $('#chat-log'),
  chatForm: $('#chat-form'),
  chatInput: $('#chat-input'),
  chatBtn: $('#chat-form button[type="submit"]'),
  chatError: $('#chat-error'),
  examples: $('.examples'),
  aiForm: $('#ai-form'),
  aiKey: $('#ai-key'),
  aiModel: $('#ai-model'),
  aiRemember: $('#ai-remember'),
  aiClear: $('#ai-clear'),
  aiStatus: $('#ai-status'),
};

/* ---------- State ---------- */
const client = createAirClient();
const state = {
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
let T = createTranslator('en');

const placeName = (place) => (place.labelKey ? T(place.labelKey) : place.label);

/* ---------- Status line ---------- */
function errorParams(error) {
  return { reasonCode: (error && error.code) || 'network', reasonParams: (error && error.params) || {} };
}

function setStatus(key, params = {}, isError = false) {
  state.status = { key, params, isError };
  renderStatus();
}

function renderStatus() {
  const { key, params, isError } = state.status;
  const resolved = params.reasonCode ? { ...params, reason: T(`err.${params.reasonCode}`, params.reasonParams) } : params;
  els.status.textContent = key ? T(key, resolved) : '';
  els.status.classList.toggle('is-error', isError);
}

/* ---------- Static text & language ---------- */
/* ---------- Glass lenses and the tab bar ---------- */
const lensOptions = { reducedMotion: prefersReducedMotion };
const lenses = {
  langHead: createLens(els.langHead, () => els.langHead.querySelector('.lang-btn[aria-pressed="true"]'), lensOptions),
  langSettings: createLens(els.langSettings, () => els.langSettings.querySelector('.lang-btn[aria-pressed="true"]'), lensOptions),
  phase: createLens(els.phaseOptions, () => els.phaseOptions.querySelector('input:checked')?.closest('.phase-option'), lensOptions),
  tabs: createLens(els.tabbar, () => els.tabbar.querySelector('.tab[aria-current]'), lensOptions),
};
let sectionSpyPausedUntil = 0;

function setActiveTab(sectionId, animate = true) {
  els.tabbar.querySelectorAll('.tab').forEach((tab) => {
    if (tab.dataset.section === sectionId) tab.setAttribute('aria-current', 'location');
    else tab.removeAttribute('aria-current');
  });
  lenses.tabs.update(animate);
}

/** Tab tap: glide the lens, scroll to the section and move focus to its heading. */
function onTabClick(event) {
  const tab = event.target.closest('.tab');
  if (tab === els.tabSettings) {
    openSettings();
    return;
  }
  const section = tab && document.getElementById(tab.dataset.section);
  if (!section) return;
  event.preventDefault();
  setActiveTab(section.id);
  sectionSpyPausedUntil = performance.now() + 1200; // let the scroll finish before the spy takes over
  section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  section.querySelector('h2')?.focus({ preventScroll: true });
}

/** Lights the tab of whichever section crosses the upper middle of the screen. */
function watchSections() {
  if (typeof IntersectionObserver !== 'function') return;
  const observer = new IntersectionObserver((entries) => {
    if (performance.now() < sectionSpyPausedUntil) return;
    const hit = entries.find((entry) => entry.isIntersecting);
    if (hit) setActiveTab(hit.target.id);
  }, { rootMargin: '-35% 0px -60% 0px' });
  els.home.querySelectorAll(':scope > section[id]').forEach((section) => observer.observe(section));
}

function applyStaticText() {
  document.documentElement.lang = state.lang;
  document.title = T('app.title');
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = T(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = T(node.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-label]').forEach((node) => {
    const params = node.dataset.i18nActivity ? { activity: T(node.dataset.i18nActivity) } : {};
    node.setAttribute('aria-label', T(node.dataset.i18nLabel, params));
  });
  document.querySelectorAll('.lang-btn').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.lang === state.lang)));
  lenses.langHead.update();
  lenses.langSettings.update();
  lenses.tabs.update(false);
  updateMotionButton();
}

function setLang(lang) {
  state.lang = resolveLang(lang);
  T = createTranslator(state.lang);
  store.set(local, KEYS.lang, state.lang);
  applyStaticText();
  renderStatus();
  renderAiStatus();
  render();
}

/* ---------- Core render ---------- */
function computeView() {
  const simulated = state.demo && state.simulatedAqi !== null;
  if (!simulated && !state.live) return null;
  const snapshot = simulated ? null : state.live.snapshot;
  const aqi = simulated ? state.simulatedAqi : snapshot.aqi;
  const window = snapshot ? findBestWindow(snapshot.hourly, snapshot.time) : null;
  const context = buildContext({ aqi, profile: state.profile, window });
  const routinePlan = planRoutine({
    routine: state.routine,
    aqi,
    hourly: snapshot ? snapshot.hourly : [],
    fromTime: snapshot ? snapshot.time : null,
    commute: state.profile.commute,
  });
  return {
    aqi,
    snapshot,
    window,
    risk: context.risk,
    plan: buildPlan(context),
    dosDonts: buildDosDonts(context),
    routinePlan,
    impact: summarizeImpact({ profile: state.profile, routinePlan }),
    place: simulated || !state.live ? null : placeName(state.live.place),
  };
}

function render() {
  state.view = computeView();
  renderHero(state.view);
  els.readout.replaceChildren(...readoutNodes(state.view, T, state.lang));
  renderMascotView(state.view);
  renderPlan(state.view);
  renderSetupPreview();
  els.setCityValue.textContent = state.live ? shortPlace(placeName(state.live.place)) : T('settings.notSet');
}

/** On the household step, a one-line reminder of the city's air ("Delhi · AQI 312 · Hazardous"). */
function renderSetupPreview() {
  const live = state.live;
  els.setupPreview.hidden = !live;
  if (!live) return;
  const band = categorize(live.snapshot.aqi).key;
  els.setupPreview.dataset.band = band;
  els.setupPreview.textContent = T('setup.preview', {
    place: shortPlace(placeName(live.place)), aqi: live.snapshot.aqi, band: T(`band.${band}`),
  });
}

/** Local hour of the reading (or of the device in what-if mode). */
function localHour(view) {
  return view && view.snapshot ? Number.parseInt(view.snapshot.time.slice(11, 13), 10) : new Date().getHours();
}

/**
 * The hero copy plus the scene's colour grade: the time of day sets the
 * light, the outdoor AQI band lays the smog over it (see grade.js).
 */
function renderHero(view) {
  const phase = state.phase === 'auto' ? phaseForHour(localHour(view)) : state.phase;
  const band = view ? view.risk.band.key : 'good';
  const grade = gradeFor(phase, band);
  for (const [name, value] of Object.entries(grade.vars)) els.stage.style.setProperty(name, value);
  const glass = heroGlassFor(grade.ink);
  els.stage.style.setProperty('--hero-glass', glass.css);
  els.stage.dataset.glass = glass.tone;
  // The whole page takes one sky colour for the time of day only: the AQI
  // changes the scene above, never the page or the cards below it.
  const sky = skyFor(grade.phase);
  for (const [name, value] of Object.entries(sky.vars)) document.documentElement.style.setProperty(name, value);
  els.themeColour?.setAttribute('content', state.screen === 'main' ? grade.vars['--sky-1'] : sky.stops[0]);
  els.stage.dataset.band = band;
  els.stage.dataset.phase = grade.phase;
  els.stage.dataset.night = String(grade.phase === 'night');
  els.heroCopy.replaceChildren(...heroNodes(view, T, state.lang, grade.phase, { demo: state.demo }));
  // The ring glides from the last reading to this one (and counts the number up).
  const gauge = els.heroCopy.querySelector('.gauge');
  state.lastGauge = gauge ? animateGauge(gauge, state.lastGauge, { reducedMotion: prefersReducedMotion() }) : null;
  if (!view) {
    els.heroCopy.append(el('button', {
      type: 'button', class: 'btn btn-primary hero-cta', dataset: { action: 'choose-city' }, text: T('home.choose'),
    }));
  }
  els.stage.dataset.demo = String(state.demo);
}

function onPhaseChange(event) {
  if (event.target.name !== 'phase') return;
  state.phase = PHASES.includes(event.target.value) ? event.target.value : 'auto';
  lenses.phase.update();
  renderHero(state.view);
}

/** Coalesces rapid slider and form input into one render per animation frame. */
function scheduleRender() {
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    render();
  });
}

function renderMascotView(view) {
  const mood = moodForLevel(view ? view.risk.level : 0);
  if (mood !== state.mood) {
    state.mood = mood;
    state.quipSeed += 1;
  }
  renderMascot(els.stage, {
    character: state.character,
    mood,
    quip: T(view ? quipKey(mood, state.quipSeed) : 'quip.idle'),
    label: T('mascot.label', { name: T(`char.${state.character}`), mood: T(`mood.${mood}`) }),
  }, { smooth: !state.paused && !prefersReducedMotion() });
}

function renderPlan(view) {
  if (!view) {
    els.plan.replaceChildren(el('p', { class: 'empty', text: T('plan.needData') }));
    return;
  }
  const total = CATEGORIES.reduce((sum, c) => sum + view.plan[c].length, 0);
  const groups = CATEGORIES.map((category) => {
    const items = view.plan[category];
    // Open groups that need action now (or all of them when the plan is
    // short), unless the user has opened or closed the group themselves.
    const fallback = items.some((rec) => rec.priority === 1) || total <= 6;
    const open = state.openGroups.has(category) ? state.openGroups.get(category) : fallback;
    return planGroup({ category, items, open }, T);
  });
  els.plan.replaceChildren(
    impactSection(view.impact, T, state.lang),
    dayPlanSection(view.routinePlan, Boolean(view.snapshot), T),
    dosDontsSection(view.dosDonts, T),
    ...groups,
  );
}

/**
 * Remembers groups the user opens or closes. Uses the summary click (fired for
 * mouse, touch and keyboard) because "toggle" also fires when code opens a group.
 */
function onPlanSummaryClick(event) {
  const summary = event.target.closest('details.plan-group > summary');
  if (!summary) return;
  const group = summary.parentElement;
  state.openGroups.set(group.dataset.category, !group.open);
}

/* ---------- Location ---------- */
function setLocating(busy, button = els.searchBtn) {
  [els.searchBtn, els.gpsBtn, ...els.quickCities.querySelectorAll('button')].forEach((btn) => {
    btn.disabled = busy;
    if (!busy) btn.classList.remove('is-loading');
  });
  if (busy) button.classList.add('is-loading');
  els.readout.setAttribute('aria-busy', String(busy));
}

async function loadPlace(place) {
  const id = ++state.requestId;
  setStatus('status.loading');
  const snapshot = await client.fetchAirQuality(place);
  if (id !== state.requestId) return; // a newer request won
  state.live = { place, snapshot };
  store.set(local, KEYS.place, placeToStore(place));
  setStatus(''); // the city now shows on the scene itself
  els.placeResults.hidden = true;
  render();
  if (state.screen === 'setup-place') showScreen(afterPlace({ setupDone: state.setupDone, editing: state.editing }), { focus: true });
}

/** Runs a location task with the busy state and error reporting handled. */
async function withLocating(button, task) {
  setLocating(true, button);
  try {
    await task();
  } catch (error) {
    setStatus('status.error', errorParams(error), true);
  } finally {
    setLocating(false);
  }
}

function showPlaceChoices(places) {
  els.placeList.replaceChildren(...places.map((place) => el('li', {}, [
    el('button', {
      type: 'button',
      class: 'btn',
      dataset: { lat: String(place.latitude), lon: String(place.longitude), label: place.label },
      text: place.label,
    }),
  ])));
  els.placeResults.hidden = places.length < 2;
}

/**
 * Typed search lists the matches when there is more than one, so the user
 * picks the right town; a one-tap city chip takes the first match.
 */
function searchPlace(query, { pickFirst = false } = {}) {
  withLocating(els.searchBtn, async () => {
    setStatus('status.searching');
    const places = await client.searchPlaces(query, state.lang);
    if (!places.length) {
      showPlaceChoices([]);
      setStatus('status.noPlace', {}, true);
      return;
    }
    if (places.length === 1 || pickFirst) {
      await loadPlace(places[0]);
      return;
    }
    showPlaceChoices(places);
    setStatus('');
  });
}

function onSearch(event) {
  event.preventDefault();
  const query = els.cityInput.value.trim();
  if (!query) {
    setStatus('status.emptyQuery', {}, true);
    els.cityInput.focus();
    return;
  }
  searchPlace(query);
}

function onPlaceChoice(event) {
  const btn = event.target.closest('button[data-lat]');
  if (!btn) return;
  withLocating(els.searchBtn, () => loadPlace({
    label: btn.dataset.label, latitude: Number(btn.dataset.lat), longitude: Number(btn.dataset.lon),
  }));
}

function onGps() {
  if (!('geolocation' in navigator)) {
    setStatus('status.gpsUnsupported', {}, true);
    return;
  }
  setLocating(true, els.gpsBtn);
  setStatus('status.loading');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => withLocating(els.gpsBtn, () => loadPlace({
      labelKey: 'loc.myLocation', latitude: coords.latitude, longitude: coords.longitude,
    })),
    () => {
      setStatus('status.gpsDenied', {}, true);
      setLocating(false);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
}

function onQuickCity(event) {
  const chip = event.target.closest('button[data-city]');
  if (!chip) return;
  els.cityInput.value = chip.dataset.city;
  searchPlace(chip.dataset.city, { pickFirst: true });
}

/* ---------- Demo mode ---------- */
/**
 * Demo mode is the only place where the AQI and the time of day can be set
 * by hand. Outside it, the scene, the buddy and the plan follow the live
 * reading and the city's own clock.
 */
function setDemo(on) {
  state.demo = Boolean(on);
  els.demoToggle.checked = state.demo;
  els.demoPanel.hidden = !state.demo;
  if (state.demo) {
    const start = demoStartAqi(state.live ? state.live.snapshot.aqi : null);
    els.simRange.value = String(start);
    els.simOutput.value = String(start);
    state.simulatedAqi = start;
  } else {
    state.simulatedAqi = null;
    state.phase = 'auto';
    els.phaseOptions.querySelectorAll('input[name="phase"]').forEach((input) => { input.checked = input.value === 'auto'; });
  }
  render();
  lenses.phase.update(false);
}

function onSimulate() {
  if (!state.demo) return;
  const value = Number(els.simRange.value);
  els.simOutput.value = String(value);
  state.simulatedAqi = value;
  scheduleRender();
}

/* ---------- Profile & routine ---------- */
const field = (name) => els.profileForm.elements.namedItem(name);
const CHECKBOXES = ['children', 'elderly', 'respiratory', 'pregnant', 'purifier', 'outdoorExercise'];

function fillTimeOptions() {
  ACTIVITY_IDS.forEach((id) => {
    field(`time-${id}`).replaceChildren(...ROUTINE_HOURS.map((h) => el('option', { value: String(h), text: formatHour(h) })));
  });
}

function readProfile() {
  const raw = Object.fromEntries(CHECKBOXES.map((name) => [name, field(name).checked]));
  raw.commute = field('commute').value;
  raw.cooking = field('cooking').value;
  raw.commuteKm = Number(field('commuteKm').value);
  return normalizeProfile(raw);
}

function readRoutine() {
  return normalizeRoutine(Object.fromEntries(ACTIVITY_IDS.map((id) => [
    id, field(`act-${id}`).checked ? Number(field(`time-${id}`).value) : null,
  ])));
}

function writeProfile(profile, routine) {
  CHECKBOXES.forEach((name) => { field(name).checked = profile[name]; });
  field('commute').value = profile.commute;
  field('cooking').value = profile.cooking;
  field('commuteKm').value = String(profile.commuteKm);
  ACTIVITY_IDS.forEach((id) => {
    const hour = routine[id];
    field(`act-${id}`).checked = hour !== null;
    field(`time-${id}`).value = String(hour === null ? ROUTINE_HOURS[0] : hour);
  });
  syncDisabledFields();
}

/** Inputs that make no sense in the current state are disabled, not hidden. */
function syncDisabledFields() {
  const wfh = field('commute').value === 'wfh';
  field('commuteKm').disabled = wfh;
  field('act-commute').disabled = wfh;
  ACTIVITY_IDS.forEach((id) => { field(`time-${id}`).disabled = !field(`act-${id}`).checked || field(`act-${id}`).disabled; });
}

function onProfileChange() {
  state.profile = readProfile();
  state.routine = readRoutine();
  syncDisabledFields();
  store.set(local, KEYS.profile, state.profile);
  store.set(local, KEYS.routine, state.routine);
  scheduleRender();
}

/* ---------- Buddy & motion ---------- */
function onBuddyChange(event) {
  if (event.target.name !== 'buddy') return;
  state.character = resolveCharacter(event.target.value);
  store.set(local, KEYS.buddy, state.character);
  renderMascotView(state.view);
}

function updateMotionButton() {
  els.stage.classList.toggle('is-paused', state.paused);
  els.motionBtn.setAttribute('aria-pressed', String(state.paused));
}

/* ---------- Screens and settings ---------- */
/**
 * Shows one screen: a setup step (first run, or opened from Settings with
 * `editing`) or the live main screen. See flow.js for the order.
 */
function showScreen(screen, { editing = state.editing, focus = false } = {}) {
  state.screen = screen;
  state.editing = screen === 'main' ? false : editing;
  document.body.dataset.screen = screen;
  els.setup.hidden = screen === 'main';
  els.secPlace.hidden = screen !== 'setup-place';
  els.secYou.hidden = screen !== 'setup-you';
  els.home.hidden = screen !== 'main';
  els.tabbar.hidden = screen !== 'main';
  els.placeCancel.hidden = !state.editing;
  els.demoStart.hidden = state.editing; // demo lives in Settings once set up
  els.youBack.hidden = state.editing;
  document.querySelectorAll('.setup .step').forEach((node) => { node.hidden = state.editing; });
  window.scrollTo(0, 0);
  if (screen === 'main') {
    setActiveTab('sec-air', false);
    lenses.phase.update(false);
  }
  if (focus) {
    const heading = screen === 'main' ? $('#air-heading') : $(`#${screen === 'setup-place' ? 'loc' : 'profile'}-heading`);
    heading?.focus({ preventScroll: true });
  }
}

function finishSetup() {
  state.setupDone = true;
  store.set(local, KEYS.setup, { done: true });
  showScreen('main', { focus: true });
}

/** Opens a setup step from anywhere (Settings, or the empty scene). */
function editStep(screen) {
  if (els.settings.open) els.settings.close();
  showScreen(screen, { editing: state.setupDone, focus: true });
}

function openSettings() {
  render();
  if (typeof els.settings.showModal === 'function') els.settings.showModal();
  else els.settings.setAttribute('open', '');
  lenses.langSettings.update(false);
}

function closeSettings() {
  if (typeof els.settings.close === 'function') els.settings.close();
  else els.settings.removeAttribute('open');
}

/* ---------- Gemini settings ---------- */
function renderAiStatus(errorKey) {
  els.aiStatus.textContent = T(errorKey || (state.ai.apiKey ? 'ai.on' : 'ai.off'));
  els.aiStatus.classList.toggle('is-error', Boolean(errorKey));
}

function onAiSave(event) {
  event.preventDefault();
  const apiKey = els.aiKey.value.trim();
  const model = els.aiModel.value.trim() || DEFAULT_GEMINI_MODEL;
  if (apiKey && !isValidApiKey(apiKey)) {
    renderAiStatus('ai.invalidKey');
    els.aiKey.focus();
    return;
  }
  if (!isValidModel(model)) {
    renderAiStatus('ai.invalidModel');
    els.aiModel.focus();
    return;
  }
  state.ai = { apiKey, model };
  els.aiModel.value = model;
  if (els.aiRemember.checked && apiKey) store.set(session, KEYS.ai, state.ai);
  else store.remove(session, KEYS.ai);
  renderAiStatus();
}

function onAiClear() {
  state.ai = { apiKey: '', model: state.ai.model };
  els.aiKey.value = '';
  store.remove(session, KEYS.ai);
  renderAiStatus();
}

/* ---------- Chat ---------- */
function fillMessage(item, role, lines, sourceKey) {
  const meta = role === 'user' ? T('chat.you') : `${T('chat.bot')} · ${T(sourceKey)}`;
  item.replaceChildren(el('p', { class: 'msg-meta', text: meta }), ...lines.map((line) => el('p', { text: line })));
}

function appendMessage(role, lines, sourceKey) {
  const item = el('li', { class: `msg msg-${role}` });
  fillMessage(item, role, lines, sourceKey);
  els.chatLog.append(item);
  item.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  return item;
}

async function onAsk(event) {
  event.preventDefault();
  els.chatError.textContent = '';
  const raw = els.chatInput.value;
  if (raw.trim().length > MAX_QUESTION_LENGTH) {
    els.chatError.textContent = T('chat.tooLong', { n: MAX_QUESTION_LENGTH });
    return;
  }
  const question = sanitizeQuestion(raw);
  if (!question) {
    els.chatError.textContent = T('chat.empty');
    els.chatInput.focus();
    return;
  }

  appendMessage('user', [question]);
  els.chatInput.value = '';

  const view = state.view;
  if (!view) {
    appendMessage('bot', [T('chat.needData')], 'chat.src.local');
    return;
  }
  const builtIn = () => localAnswer({
    question, plan: view.plan, risk: view.risk, translate: T, dosDonts: view.dosDonts, routinePlan: view.routinePlan,
  }).split('\n');

  if (!state.ai.apiKey) {
    appendMessage('bot', builtIn(), 'chat.src.local');
    return;
  }

  const pending = appendMessage('bot', [T('chat.thinking')], 'chat.src.gemini');
  els.chatBtn.disabled = true;
  try {
    const answer = await askGemini({
      apiKey: state.ai.apiKey,
      model: state.ai.model,
      systemPrompt: buildSystemPrompt(state.lang),
      userPrompt: buildUserPrompt({
        question,
        place: view.place,
        snapshot: view.snapshot,
        risk: view.risk,
        profile: state.profile,
        plan: view.plan,
        dosDonts: view.dosDonts,
        routinePlan: view.routinePlan,
        translate: T,
      }),
    });
    fillMessage(pending, 'bot', toPlainLines(answer), 'chat.src.gemini');
  } catch (error) {
    const reason = T(`err.${error.code || 'network'}`, error.params || {});
    fillMessage(pending, 'bot', [T('chat.fallback', { reason }), ...builtIn()], 'chat.src.local');
  } finally {
    els.chatBtn.disabled = false;
  }
}

function onExample(event) {
  const chip = event.target.closest('[data-example]');
  if (!chip) return;
  els.chatInput.value = T(chip.dataset.example);
  els.chatForm.requestSubmit();
}

/* ---------- Boot ---------- */
function restoreSettings() {
  const savedLang = store.get(local, KEYS.lang);
  const browserHindi = (navigator.language || '').toLowerCase().startsWith('hi');
  state.lang = resolveLang(savedLang || (browserHindi ? 'hi' : 'en'));
  T = createTranslator(state.lang);

  state.character = resolveCharacter(store.get(local, KEYS.buddy));
  els.buddyPicker.querySelectorAll('input[name="buddy"]').forEach((input) => { input.checked = input.value === state.character; });

  state.profile = normalizeProfile(store.get(local, KEYS.profile) || DEFAULT_PROFILE);
  state.routine = normalizeRoutine(store.get(local, KEYS.routine));
  fillTimeOptions();
  writeProfile(state.profile, state.routine);

  const savedAi = store.get(session, KEYS.ai);
  if (savedAi && isValidApiKey(savedAi.apiKey)) {
    state.ai = { apiKey: savedAi.apiKey, model: isValidModel(savedAi.model) ? savedAi.model : DEFAULT_GEMINI_MODEL };
    els.aiKey.value = state.ai.apiKey;
    els.aiRemember.checked = true;
  }
  els.aiModel.value = state.ai.model;
}

function bindEvents() {
  els.searchForm.addEventListener('submit', onSearch);
  els.placeList.addEventListener('click', onPlaceChoice);
  els.gpsBtn.addEventListener('click', onGps);
  els.quickCities.addEventListener('click', onQuickCity);
  els.simRange.addEventListener('input', onSimulate);
  els.demoToggle.addEventListener('change', () => setDemo(els.demoToggle.checked));
  els.demoExit.addEventListener('click', () => setDemo(false));
  els.demoStart.addEventListener('click', () => {
    setDemo(true);
    showScreen('main', { focus: true });
  });
  els.placeCancel.addEventListener('click', () => showScreen('main', { focus: true }));
  els.youBack.addEventListener('click', () => showScreen('setup-place', { focus: true }));
  els.youDone.addEventListener('click', finishSetup);
  els.setCity.addEventListener('click', () => editStep('setup-place'));
  els.setHome.addEventListener('click', () => editStep('setup-you'));
  els.settingsDone.addEventListener('click', closeSettings);
  els.settings.addEventListener('click', (event) => {
    if (event.target === els.settings) closeSettings(); // a tap on the dimmed backdrop
  });
  els.stage.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="choose-city"]')) editStep('setup-place');
  });
  els.profileForm.addEventListener('change', onProfileChange);
  els.profileForm.addEventListener('submit', (event) => event.preventDefault());
  els.buddyPicker.addEventListener('change', onBuddyChange);
  els.phasePicker.addEventListener('change', onPhaseChange);
  els.plan.addEventListener('click', onPlanSummaryClick);
  els.motionBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    updateMotionButton();
  });
  els.chatForm.addEventListener('submit', onAsk);
  els.chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.chatForm.requestSubmit();
    }
  });
  els.examples.addEventListener('click', onExample);
  els.aiForm.addEventListener('submit', onAiSave);
  els.aiClear.addEventListener('click', onAiClear);
  document.querySelectorAll('.lang-btn').forEach((btn) => btn.addEventListener('click', () => setLang(btn.dataset.lang)));
  els.tabbar.addEventListener('click', onTabClick);
  enablePress(document, { reducedMotion: prefersReducedMotion });
  enableWipe(document, { reducedMotion: prefersReducedMotion });
}

function init() {
  restoreSettings();
  bindEvents();
  const savedPlace = restorePlace(store.get(local, KEYS.place));
  const hasPlace = Boolean(savedPlace);
  state.setupDone = normalizeSetup(store.get(local, KEYS.setup)).done;
  showScreen(startScreen({ setupDone: state.setupDone, hasPlace }), { editing: false });
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
