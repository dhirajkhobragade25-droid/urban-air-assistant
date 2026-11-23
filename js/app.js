/**
 * UI controller: wires the DOM to the pure modules.
 * All dynamic text is set with textContent (never innerHTML).
 */
import { DEFAULT_PROFILE, normalizeProfile, findBestWindow, formatRange, whoMultiple } from './engine.js';
import { CATEGORIES, buildContext, buildPlan, buildDosDonts } from './advice.js';
import { createTranslator, resolveLang, formatNumber } from './i18n.js';
import { createAirClient } from './api.js';
import { moodForLevel, quipKey, renderMascot, resolveCharacter, DEFAULT_CHARACTER } from './mascot.js';
import {
  DEFAULT_GEMINI_MODEL, MAX_QUESTION_LENGTH, askGemini, buildSystemPrompt, buildUserPrompt,
  describeAdvice, isValidApiKey, isValidModel, localAnswer, sanitizeQuestion, toPlainLines,
} from './assistant.js';

/* ---------- Storage (fails safely in private mode) ---------- */
const KEYS = { lang: 'uaqa.lang', profile: 'uaqa.profile', place: 'uaqa.place', ai: 'uaqa.ai', buddy: 'uaqa.buddy' };

function safeStorage(name) {
  try {
    const area = window[name];
    const probe = '__uaqa__';
    area.setItem(probe, probe);
    area.removeItem(probe);
    return area;
  } catch {
    return null;
  }
}
const local = safeStorage('localStorage');
const session = safeStorage('sessionStorage');

const store = {
  get(area, key) {
    try { return area ? JSON.parse(area.getItem(key)) : null; } catch { return null; }
  },
  set(area, key, value) {
    try { if (area) area.setItem(key, JSON.stringify(value)); } catch { /* quota or disabled */ }
  },
  remove(area, key) {
    try { if (area) area.removeItem(key); } catch { /* ignore */ }
  },
};

/* ---------- DOM ---------- */
const $ = (selector) => document.querySelector(selector);
const els = {
  searchForm: $('#search-form'),
  cityInput: $('#city-input'),
  searchBtn: $('#search-form button[type="submit"]'),
  gpsBtn: $('#gps-btn'),
  placeResults: $('#place-results'),
  placeList: $('#place-results ul'),
  status: $('#status'),
  stage: $('#stage'),
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
  aiForm: $('#ai-form'),
  aiKey: $('#ai-key'),
  aiModel: $('#ai-model'),
  aiRemember: $('#ai-remember'),
  aiClear: $('#ai-clear'),
  aiStatus: $('#ai-status'),
};

/** Small element builder that only ever sets text, never HTML. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child !== null && child !== undefined) node.append(child);
  return node;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- State ---------- */
const client = createAirClient();
const state = {
  lang: 'en',
  profile: normalizeProfile(DEFAULT_PROFILE),
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
};
let T = createTranslator('en');

const placeName = (place) => (place.labelKey ? T(place.labelKey) : place.label);

/* ---------- Status ---------- */
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
  return {
    aqi,
    snapshot,
    window,
    risk: context.risk,
    plan: buildPlan(context),
    dosDonts: buildDosDonts(context),
    place: simulated || !state.live ? null : placeName(state.live.place),
  };
}

function render() {
  state.view = computeView();
  renderReadout(state.view);
  renderMascotView(state.view);
  renderPlan(state.view);
}

/** Coalesces rapid slider input into one render per animation frame. */
function scheduleRender() {
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    render();
  });
}

function renderReadout(view) {
  const box = els.readout;
  box.replaceChildren();
  if (!view) {
    box.append(el('p', { class: 'empty', text: T('air.empty') }));
    return;
  }
  const { risk, snapshot, window } = view;
  box.append(
    el('div', { class: 'aqi-big' }, [
      el('span', { class: 'aqi-number', text: String(view.aqi) }),
      el('span', { class: 'aqi-unit', text: T('air.aqiLabel') }),
    ]),
    el('span', { class: 'band-chip', dataset: { band: risk.band.key }, text: T(`band.${risk.band.key}`) }),
    el('p', { class: 'personal' }, [
      el('span', { class: 'band-chip', dataset: { band: risk.personal.key }, text: T('air.personal', { label: T(`band.${risk.personal.key}`) }) }),
    ]),
  );
  if (risk.raised) box.append(el('p', { class: 'raised', text: T('air.raised') }));

  if (!snapshot) {
    box.append(el('p', { class: 'hint', text: T('air.simulated') }));
    return;
  }

  const readings = [['air.pm25', snapshot.pm25], ['air.pm10', snapshot.pm10], ['air.no2', snapshot.no2], ['air.o3', snapshot.o3]]
    .filter(([, value]) => value !== null)
    .map(([key, value]) => el('div', {}, [el('dt', { text: T(key) }), el('dd', { text: formatNumber(state.lang, Math.round(value)) })]));
  if (readings.length) {
    box.append(el('p', { class: 'hint', text: T('air.pollutants') }), el('dl', { class: 'pollutants' }, readings));
  }

  const multiple = whoMultiple(snapshot.pm25);
  if (multiple !== null) {
    box.append(el('p', { text: multiple > 1 ? T('air.who', { x: formatNumber(state.lang, multiple) }) : T('air.whoOk') }));
  }

  if (window) {
    box.append(el('ul', { class: 'windows' }, [
      el('li', { class: 'is-best', text: T('air.best', { range: formatRange(window.start, window.hours), nextDay: window.nextDay }) }),
      el('li', { class: 'is-worst', text: T('air.worst', { range: formatRange(window.worstStart, window.hours), nextDay: window.worstNextDay }) }),
    ]));
  }
  box.append(el('p', { class: 'updated', text: T('air.updated', { time: snapshot.time.slice(11, 16) }) }));
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
    quip: T(quipKey(mood, state.quipSeed)),
    label: T('mascot.label', { name: T(`char.${state.character}`), mood: T(`mood.${mood}`) }),
  });
}

function adviceCard(rec) {
  const text = describeAdvice(rec, T);
  return el('li', { class: 'advice', dataset: { priority: String(rec.priority) } }, [
    el('div', { class: 'advice-head' }, [
      el('p', { class: 'advice-title', text: text.title }),
      el('span', { class: 'prio-tag', text: T(`priority.${rec.priority}`) }),
    ]),
    el('p', { class: 'advice-action', text: text.action }),
    el('p', { class: 'advice-why' }, [el('strong', { text: T('plan.why') }), text.why]),
  ]);
}

function renderPlan(view) {
  els.plan.replaceChildren();
  if (!view) {
    els.plan.append(el('p', { class: 'empty', text: T('plan.needData') }));
    return;
  }
  els.plan.append(renderDosDonts(view.dosDonts));
  for (const category of CATEGORIES) {
    const items = view.plan[category];
    els.plan.append(el('section', { class: 'plan-group', 'aria-labelledby': `plan-${category}` }, [
      el('h3', { id: `plan-${category}`, text: T(`plan.cat.${category}`) }),
      items.length
        ? el('ul', {}, items.map(adviceCard))
        : el('p', { class: 'empty', text: T('plan.empty') }),
    ]));
  }
}

function renderDosDonts({ dos, donts }) {
  const column = (kind, list, prefix) => el('div', { class: `dd-col dd-${kind}` }, [
    el('h4', { text: T(`dd.${kind}`) }),
    el('ul', {}, list.map((item) => el('li', { text: T(`${prefix}.${item.id}`, item.params) }))),
  ]);
  return el('section', { class: 'dd', 'aria-labelledby': 'dd-heading' }, [
    el('h3', { id: 'dd-heading', text: T('dd.heading') }),
    el('div', { class: 'dd-cols' }, [column('do', dos, 'do'), column('dont', donts, 'dont')]),
  ]);
}

/* ---------- Location ---------- */
function setLocating(busy) {
  els.searchBtn.disabled = busy;
  els.gpsBtn.disabled = busy;
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

function showPlaceChoices(places) {
  els.placeList.replaceChildren(...places.map((place) => el('li', {}, [
    el('button', { type: 'button', class: 'btn', dataset: { lat: String(place.latitude), lon: String(place.longitude), label: place.label }, text: place.label }),
  ])));
  els.placeResults.hidden = places.length < 2;
}

async function onSearch(event) {
  event.preventDefault();
  const query = els.cityInput.value.trim();
  if (!query) {
    setStatus('status.emptyQuery', {}, true);
    els.cityInput.focus();
    return;
  }
  setLocating(true);
  setStatus('status.searching');
  try {
    const places = await client.searchPlaces(query, state.lang);
    if (!places.length) {
      showPlaceChoices([]);
      setStatus('status.noPlace', {}, true);
      return;
    }
    showPlaceChoices(places);
    await loadPlace(places[0]);
  } catch (error) {
    setStatus('status.error', errorParams(error), true);
  } finally {
    setLocating(false);
  }
}

async function onPlaceChoice(event) {
  const btn = event.target.closest('button[data-lat]');
  if (!btn) return;
  setLocating(true);
  try {
    await loadPlace({ label: btn.dataset.label, latitude: Number(btn.dataset.lat), longitude: Number(btn.dataset.lon) });
  } catch (error) {
    setStatus('status.error', errorParams(error), true);
  } finally {
    setLocating(false);
  }
}

function onGps() {
  if (!('geolocation' in navigator)) {
    setStatus('status.gpsUnsupported', {}, true);
    return;
  }
  setLocating(true);
  setStatus('status.loading');
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      try {
        await loadPlace({ labelKey: 'loc.myLocation', latitude: coords.latitude, longitude: coords.longitude });
      } catch (error) {
        setStatus('status.error', errorParams(error), true);
      } finally {
        setLocating(false);
      }
    },
    () => {
      setStatus('status.gpsDenied', {}, true);
      setLocating(false);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
}

/* ---------- Simulator ---------- */
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

/* ---------- Profile ---------- */
const field = (name) => els.profileForm.elements.namedItem(name);
const CHECKBOXES = ['children', 'elderly', 'respiratory', 'pregnant', 'purifier', 'outdoorExercise'];

function readProfile() {
  const raw = Object.fromEntries(CHECKBOXES.map((name) => [name, field(name).checked]));
  raw.commute = field('commute').value;
  raw.cooking = field('cooking').value;
  raw.commuteKm = Number(field('commuteKm').value);
  return normalizeProfile(raw);
}

function writeProfile(profile) {
  CHECKBOXES.forEach((name) => { field(name).checked = profile[name]; });
  field('commute').value = profile.commute;
  field('cooking').value = profile.cooking;
  field('commuteKm').value = String(profile.commuteKm);
  field('commuteKm').disabled = profile.commute === 'wfh';
}

function onProfileChange() {
  state.profile = readProfile();
  field('commuteKm').disabled = state.profile.commute === 'wfh';
  store.set(local, KEYS.profile, state.profile);
  scheduleRender();
}

/* ---------- Buddy choice ---------- */
function onBuddyChange(event) {
  if (event.target.name !== 'buddy') return;
  state.character = resolveCharacter(event.target.value);
  store.set(local, KEYS.buddy, state.character);
  renderMascotView(state.view);
}

/* ---------- Mascot motion control ---------- */
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
function appendMessage(role, lines, sourceKey) {
  const item = el('li', { class: `msg msg-${role}` });
  fillMessage(item, role, lines, sourceKey);
  els.chatLog.append(item);
  item.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  return item;
}

function fillMessage(item, role, lines, sourceKey) {
  const meta = role === 'user' ? T('chat.you') : `${T('chat.bot')} · ${T(sourceKey)}`;
  item.replaceChildren(el('p', { class: 'msg-meta', text: meta }), ...lines.map((line) => el('p', { text: line })));
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
    question, plan: view.plan, risk: view.risk, translate: T, dosDonts: view.dosDonts,
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
function init() {
  const savedLang = store.get(local, KEYS.lang);
  const browserHindi = (navigator.language || '').toLowerCase().startsWith('hi');
  state.lang = resolveLang(savedLang || (browserHindi ? 'hi' : 'en'));
  T = createTranslator(state.lang);

  state.character = resolveCharacter(store.get(local, KEYS.buddy));
  els.buddyPicker.querySelectorAll('input[name="buddy"]').forEach((input) => { input.checked = input.value === state.character; });

  state.profile = normalizeProfile(store.get(local, KEYS.profile) || DEFAULT_PROFILE);
  writeProfile(state.profile);

  const savedAi = store.get(session, KEYS.ai);
  if (savedAi && isValidApiKey(savedAi.apiKey)) {
    state.ai = { apiKey: savedAi.apiKey, model: isValidModel(savedAi.model) ? savedAi.model : DEFAULT_GEMINI_MODEL };
    els.aiKey.value = state.ai.apiKey;
    els.aiRemember.checked = true;
  }
  els.aiModel.value = state.ai.model;

  els.searchForm.addEventListener('submit', onSearch);
  els.placeList.addEventListener('click', onPlaceChoice);
  els.gpsBtn.addEventListener('click', onGps);
  els.simRange.addEventListener('input', onSimulate);
  els.simReset.addEventListener('click', onSimReset);
  els.profileForm.addEventListener('change', onProfileChange);
  els.profileForm.addEventListener('submit', (event) => event.preventDefault());
  els.buddyPicker.addEventListener('change', onBuddyChange);
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
  document.querySelector('.examples').addEventListener('click', onExample);
  els.aiForm.addEventListener('submit', onAiSave);
  els.aiClear.addEventListener('click', onAiClear);
  document.querySelectorAll('.lang-btn').forEach((btn) => btn.addEventListener('click', () => setLang(btn.dataset.lang)));

  applyStaticText();
  renderAiStatus();
  render();

  const lastPlace = store.get(local, KEYS.place);
  if (lastPlace && typeof lastPlace.label === 'string') {
    els.cityInput.value = lastPlace.label.split(',')[0];
    loadPlace({ label: lastPlace.label, latitude: Number(lastPlace.latitude), longitude: Number(lastPlace.longitude) })
      .catch((error) => setStatus('status.error', errorParams(error), true));
  }
}

init();
