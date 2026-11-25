/**
 * The one-line status under the city search ("Fetching live air data…").
 */
import { els } from './elements.js';
import { state, T } from './state.js';

/** Turns an API error into the params of the 'status.error' message. */
export function errorParams(error) {
  return { reasonCode: error?.code || 'network', reasonParams: error?.params || {} };
}

/**
 * Shows a status message (or clears it with an empty key).
 * @param {string} key
 * @param {object} [params]
 * @param {boolean} [isError]
 */
export function setStatus(key, params = {}, isError = false) {
  state.status = { key, params, isError };
  renderStatus();
}

/** Draws the current status in the current language. */
export function renderStatus() {
  const { key, params, isError } = state.status;
  const resolved = params.reasonCode
    ? { ...params, reason: T(`err.${params.reasonCode}`, params.reasonParams) }
    : params;
  els.status.textContent = key ? T(key, resolved) : '';
  els.status.classList.toggle('is-error', isError);
}
