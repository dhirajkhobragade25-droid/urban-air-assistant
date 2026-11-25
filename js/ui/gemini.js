/**
 * Gemini settings: the user's own API key and model. The key stays in
 * memory, or in sessionStorage if the user asks, and is sent only to Google.
 */
import { DEFAULT_GEMINI_MODEL, isValidApiKey, isValidModel } from '../assistant.js';
import { KEYS, store } from '../storage.js';
import { els } from './elements.js';
import { state, session, T } from './state.js';

/** Shows whether Gemini is on, or why the last save failed. */
export function renderAiStatus(errorKey) {
  els.aiStatus.textContent = T(errorKey || (state.ai.apiKey ? 'ai.on' : 'ai.off'));
  els.aiStatus.classList.toggle('is-error', Boolean(errorKey));
}

/** Loads a key saved for this tab, if the user chose to keep it. */
export function restoreAi() {
  const saved = store.get(session, KEYS.ai);
  if (saved && isValidApiKey(saved.apiKey)) {
    state.ai = { apiKey: saved.apiKey, model: isValidModel(saved.model) ? saved.model : DEFAULT_GEMINI_MODEL };
    els.aiKey.value = state.ai.apiKey;
    els.aiRemember.checked = true;
  }
  els.aiModel.value = state.ai.model;
}

/** Validates and saves the key and model. */
export function onAiSave(event) {
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

/** Forgets the key. */
export function onAiClear() {
  state.ai = { apiKey: '', model: state.ai.model };
  els.aiKey.value = '';
  store.remove(session, KEYS.ai);
  renderAiStatus();
}
