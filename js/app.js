/**
 * UI controller: owns the page state, listens to events and puts the nodes
 * built by views.js on the page. All decisions live in the pure modules
 * (engine, advice, routine, assistant), which are unit-tested.
 */
import { DEFAULT_PROFILE, normalizeProfile, findBestWindow } from './engine.js';
import { CATEGORIES, buildContext, buildPlan, buildDosDonts } from './advice.js';
import { ACTIVITY_IDS, ROUTINE_HOURS, normalizeRoutine, planRoutine, summarizeImpact, formatHour } from './routine.js';
import { createTranslator, resolveLang } from './i18n.js';
import { createAirClient } from './api.js';
import { moodForLevel, quipKey, renderMascot, resolveCharacter, DEFAULT_CHARACTER } from './mascot.js';
import {
  DEFAULT_GEMINI_MODEL, MAX_QUESTION_LENGTH, askGemini, buildSystemPrompt, buildUserPrompt,
  isValidApiKey, isValidModel, localAnswer, sanitizeQuestion, toPlainLines,
} from './assistant.js';
import { $, el, prefersReducedMotion } from './dom.js';
import { KEYS, openStorage, store } from './storage.js';
import {
  readoutNodes, planGroup, dosDontsSection, dayPlanSection, impactSection,
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
  stageAqi: $('[data-role="stage-aqi"]'),
  motionBtn: $('#motion-btn'),
  buddyPicker: $('.buddy-picker'),
  readout: $('#readout'),
  simRange: $('#sim-range'),
  simOutput: $('#sim-output'),
  simReset: $('#sim-reset'),
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
function applyStaticText() {
  document.documentElement.lang = state.lang;
  document.title = T('app.title');
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = T(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = T(node.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-label]').forEach((node) => {
    node.setAttribute('aria-label', T(node.dataset.i18nLabel, { activity: T(node.dataset.i18nActivity) }));
  });
  document.querySelectorAll('.lang-btn').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.lang === state.lang)));
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
  const simulated = state.simulatedAqi !== null;
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
  els.readout.replaceChildren(...readoutNodes(state.view, T, state.lang));
  renderMascotView(state.view);
  renderPlan(state.view);
}

/** Coalesces rapid slider and form input into one render per animation frame. */
function scheduleRender() {
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    render();
  });
}

function renderStageBadge(view) {
  const badge = els.stageAqi;
  badge.hidden = !view;
  els.stage.classList.toggle('has-aqi', Boolean(view));
  if (!view) return;
  badge.dataset.band = view.risk.band.key;
  badge.querySelector('strong').textContent = String(view.aqi);
  badge.querySelector('span').textContent = T(`band.${view.risk.band.key}`);
}

function renderMascotView(view) {
  const mood = moodForLevel(view ? view.risk.level : 0);
  if (mood !== state.mood) {
    state.mood = mood;
    state.quipSeed += 1;
  }
  renderStageBadge(view);
  renderMascot(els.stage, {
    character: state.character,
    mood,
    quip: T(view ? quipKey(mood, state.quipSeed) : 'quip.idle'),
    label: T('mascot.label', { name: T(`char.${state.character}`), mood: T(`mood.${mood}`) }),
  });
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
  state.simulatedAqi = null;
  els.simRange.value = String(Math.min(snapshot.aqi, 500));
  els.simOutput.value = String(snapshot.aqi);
  els.simReset.hidden = true;
  if (!place.labelKey) store.set(local, KEYS.place, { label: place.label, latitude: place.latitude, longitude: place.longitude });
  setStatus('status.ready', { place: placeName(place) });
  render();
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

function onSearch(event) {
  event.preventDefault();
  const query = els.cityInput.value.trim();
  if (!query) {
    setStatus('status.emptyQuery', {}, true);
    els.cityInput.focus();
    return;
  }
  withLocating(els.searchBtn, async () => {
    setStatus('status.searching');
    const places = await client.searchPlaces(query, state.lang);
    showPlaceChoices(places);
    if (!places.length) {
      setStatus('status.noPlace', {}, true);
      return;
    }
    await loadPlace(places[0]);
  });
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
  els.searchForm.requestSubmit();
}

/* ---------- "What if?" simulator ---------- */
function onSimulate() {
  const value = Number(els.simRange.value);
  els.simOutput.value = String(value);
  state.simulatedAqi = value;
  els.simReset.hidden = !state.live;
  setStatus('status.simulated', { aqi: value });
  scheduleRender();
}

function onSimReset() {
  state.simulatedAqi = null;
  els.simReset.hidden = true;
  if (state.live) {
    els.simRange.value = String(Math.min(state.live.snapshot.aqi, 500));
    els.simOutput.value = String(state.live.snapshot.aqi);
    setStatus('status.ready', { place: placeName(state.live.place) });
  }
  render();
  els.simRange.focus();
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
  els.motionBtn.textContent = T(state.paused ? 'mascot.play' : 'mascot.pause');
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
  els.simReset.addEventListener('click', onSimReset);
  els.profileForm.addEventListener('change', onProfileChange);
  els.profileForm.addEventListener('submit', (event) => event.preventDefault());
  els.buddyPicker.addEventListener('change', onBuddyChange);
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
}

function init() {
  restoreSettings();
  bindEvents();
  applyStaticText();
  renderAiStatus();
  render();

  const lastPlace = store.get(local, KEYS.place);
  if (lastPlace && typeof lastPlace.label === 'string') {
    els.cityInput.value = lastPlace.label.split(',')[0];
    withLocating(els.searchBtn, () => loadPlace({
      label: lastPlace.label, latitude: Number(lastPlace.latitude), longitude: Number(lastPlace.longitude),
    }));
  }
}

init();
